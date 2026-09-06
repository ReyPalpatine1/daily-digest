import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { checkRefundEligibility, REFUND_PERIOD_DAYS } from '@/lib/refund-eligibility'
import { enforceChannelLimit, restoreDeliveryToEmail } from '@/lib/plan-sync'

// 사용자 환불 — 본인의 가장 최근 결제 1건.
// 판정 기준은 lib/refund-eligibility.ts 한 곳에 있다(환불정책 제3조).
//
// ★ payment_key는 어느 응답에도 담지 않는다. 화면에 필요한 건 자격 여부·금액·결제일뿐이다.

const DAY_MS = 24 * 60 * 60 * 1000

// 환불 후 남는 이용 기간(ISO). 이 결제가 부여한 30일을 만료일에서 빼고,
// 그러고도 지금보다 미래면 그 시각을, 아니면 null(즉시 무료 전환)을 돌려준다.
function refundedExpiresAt(planExpiresAt: string | null, nowMs: number): string | null {
  const expiresMs = planExpiresAt ? Date.parse(planExpiresAt) : NaN
  // 만료일이 없거나 깨져 있으면 남은 기간을 계산할 수 없다 — 차감 결과를 0으로 보아 내린다.
  if (Number.isNaN(expiresMs)) return null
  const reducedMs = expiresMs - REFUND_PERIOD_DAYS * DAY_MS
  return reducedMs > nowMs ? new Date(reducedMs).toISOString() : null
}

// 자격 조회 — 화면이 버튼을 어떻게 그릴지(그리고 어떤 안내를 띄울지) 정하는 데만 쓴다.
export async function GET() {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 핸들러 안에서 읽는다.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const eligibility = await checkRefundEligibility(serviceClient, user.id)

  if (!eligibility.ok) {
    return NextResponse.json({ eligible: false, reason: eligibility.reason })
  }
  // 확인창이 "자동 갱신도 함께 해지되는지"를 말해야 하므로 자격이 있을 때만 계정 상태를 함께 본다.
  // 환불 후 만료일은 내려보내지 않는다 — 창을 닫으면 프로필 플랜 카드에서 바로 확인된다.
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('plan_status')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) {
    // 안내 값만 못 채우는 것이라 자격 판정은 그대로 내려준다(자동 갱신 문구만 1개월권용이 된다).
    console.error('[billing/refund] 프로필 조회 실패:', user.id, profileError?.message)
  }

  return NextResponse.json({
    eligible: true,
    amount: eligibility.payment.amount,
    paidAt: eligibility.payment.createdAt,
    isAutoRenew: profile?.plan_status === 'active',
  })
}

// 환불 실행.
//
// ★ GET 결과를 믿지 않고 판정을 다시 실행한다. 화면은 캐시된 값을 보고 있을 수 있고,
//   그 사이 다이제스트가 발송되었거나 기간이 지났을 수 있다.
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 1. 자격 재확인.
  const eligibility = await checkRefundEligibility(serviceClient, user.id)
  if (!eligibility.ok) {
    return NextResponse.json({ error: 'not_eligible', reason: eligibility.reason }, { status: 409 })
  }
  const payment = eligibility.payment

  // 2. 토스 결제 취소.
  //
  // TODO: 토스 승인 후 연결 — cancelPayment(payment.paymentKey, '사용자 환불 요청').
  //   지금은 실결제 0건이고 빌링 심사 중이라 검증할 수 없어 호출하지 않는다.
  //
  // ★ 여기서 실패하면 아래 3~4를 실행하면 안 된다. 돈을 돌려주지 않은 채 계정만 내리면
  //   사용자는 결제한 기간도 잃고 환불도 못 받는다 — 이 기능에서 가장 나쁜 결과다.
  //   연결할 때는 취소 호출을 try/catch로 감싸고, 실패 시 여기서 500으로 즉시 반환할 것
  //   (계정 처리·refunded_at 기록에 도달하지 못하게 한다).

  // 3. 계정 처리 — 이 결제가 부여한 30일을 이용 기간에서 뺀다(환불정책 제4조 4항).
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('plan, plan_status, plan_expires_at')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    console.error('[billing/refund] 프로필 조회 실패:', user.id, profileError?.message)
    return NextResponse.json({ error: 'profile_failed' }, { status: 500 })
  }

  const nowMs = Date.now()
  // GET(확인창 안내)과 같은 함수로 계산한다 — 안내한 날짜와 실제 결과가 어긋나지 않게.
  const expiresAfter = refundedExpiresAt((profile.plan_expires_at as string | null) ?? null, nowMs)

  // 자동 갱신 중이었다면 함께 해지한다. 카드를 남기는 것은 기존 해지 기능과 같다 —
  // 환불은 그 결제를 무르는 것이지 계정을 정리하는 것이 아니다.
  const cancelAutoRenew = profile.plan_status === 'active'

  // 차감하고도 기간이 남으면 Pro를 유지한다(1개월권을 이어 붙여 기간이 쌓인 경우).
  const update: Record<string, unknown> = expiresAfter
    ? {
        plan_expires_at: expiresAfter,
        ...(cancelAutoRenew ? { plan_status: 'onetime', cancel_at_period_end: false } : {}),
      }
    : {
        plan: 'free',
        plan_status: 'none',
        plan_expires_at: null,
        plan_changed_at: new Date().toISOString(),
        ...(cancelAutoRenew ? { cancel_at_period_end: false } : {}),
      }

  const { error: updateError } = await serviceClient
    .from('profiles')
    .update(update)
    .eq('id', user.id)

  if (updateError) {
    console.error('[billing/refund] 플랜 차감 실패:', user.id, updateError.message)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  // 3-1. 무료로 내려간 경우에만 강등 정리를 함께 한다.
  //      지금까지 이 경로는 profiles만 고쳐 채널이 7개 모두 활성인 채 free로 남았다
  //      (cron의 만료 정리는 "만료일이 지난 pro"를 찾으므로 이미 free인 계정은 영영 대상이 아니다).
  //      기간이 남아 Pro가 유지되는 환불에서는 부르지 않는다 — 여전히 Pro이므로 채널을 잠그면 안 된다.
  //
  //      실패해도 환불 자체는 성공 처리한다 — 돈은 이미 처리된 상태라 되돌리면 더 나쁘다.
  //      채널은 다음 syncUserPlan 호출(발송 경로)에서도 정리될 여지가 있으나,
  //      로그로 남겨 수동 확인이 가능하게 한다.
  if (!expiresAfter) {
    try {
      await enforceChannelLimit(user.id)
      await restoreDeliveryToEmail(user.id)
    } catch (e) {
      console.error(
        `[billing/refund] ⚠️ 무료 강등 정리 실패(플랜은 free로 내려감 — 채널/발송 수동 확인 필요): user=${user.id}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  // 4. 환불 이력 기록 — 같은 결제를 두 번 환불하지 못하게 막는 잠금이기도 하다.
  //    여기서 실패해도 플랜은 이미 차감됐으므로 되돌리지 않고(되돌리면 돈과 기간이 어긋난다)
  //    잠금이 안 걸린 상태를 눈에 띄게 남긴다.
  const { error: markError } = await serviceClient
    .from('payments')
    .update({ refunded_at: new Date().toISOString() })
    .eq('id', payment.id)

  if (markError) {
    console.error(
      `[billing/refund] ⚠️ 환불 이력 기록 실패(플랜은 차감됨 — 재환불 잠금 없음): payment=${payment.id} user=${user.id}:`,
      markError.message,
    )
  }

  console.log(
    `[billing/refund] 환불 완료: user=${user.id} payment=${payment.id} amount=${payment.amount} ` +
    `expiresAfter=${expiresAfter ?? 'free(즉시 종료)'}`,
  )

  return NextResponse.json({ ok: true })
}
