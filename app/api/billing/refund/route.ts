import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { checkRefundEligibility } from '@/lib/refund-eligibility'
import { applyRefundToAccount } from '@/lib/refund-apply'
import { cancelTossPayment } from '@/lib/billing'

// 사용자 환불 — 본인의 가장 최근 결제 1건.
// 판정 기준은 lib/refund-eligibility.ts 한 곳에 있다(환불정책 제3조).
//
// ★ payment_key는 어느 응답에도 담지 않는다. 화면에 필요한 건 자격 여부·금액·결제일뿐이다.

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
  // ★ 여기서 실패하면 아래 3~4를 실행하면 안 된다. 돈을 돌려주지 않은 채 계정만 내리면
  //   사용자는 결제한 기간도 잃고 환불도 못 받는다 — 이 기능에서 가장 나쁜 결과다.
  //   실패는 전부 여기서 즉시 반환한다(계정 처리·refunded_at 기록에 도달하지 못한다).
  //   화면은 실패 응답을 받으면 기존 안내(profile.refundFailed)를 띄운다.
  // ★ 시크릿은 결제 종류로 고른다: auto → 자동결제 계약, onetime → 일반결제 계약.
  // ★ 서버 로그에는 토스 에러 code/message만 남긴다(paymentKey·시크릿 금지).
  if (!payment.paymentKey || (payment.kind !== 'auto' && payment.kind !== 'onetime')) {
    console.error('[billing/refund] 취소 불가(결제 정보 부족):', user.id, {
      payment: payment.id,
      hasPaymentKey: !!payment.paymentKey,
      kind: payment.kind,
    })
    return NextResponse.json({ error: 'cancel_failed' }, { status: 500 })
  }

  const cancel = await cancelTossPayment({
    paymentKey: payment.paymentKey,
    kind: payment.kind,
    reason: '사용자 환불 요청',
    // 결제 행 기준 고정값 — 같은 결제의 재시도·중복 요청이 토스에서 한 번만 처리된다.
    idempotencyKey: `refund_${payment.id}`,
  })
  if (!cancel.ok) {
    console.error('[billing/refund] 토스 취소 실패:', user.id, {
      payment: payment.id,
      code: cancel.code,
      message: cancel.message,
    })
    return NextResponse.json({ error: 'cancel_failed' }, { status: 502 })
  }
  if (cancel.alreadyCanceled) {
    // 앞선 시도가 토스 취소까지는 마쳤는데 우리 쪽 처리 전에 끊긴 경우 — 성공으로 보고 이어간다.
    console.warn('[billing/refund] 이미 토스에서 취소된 결제 — 계정 처리를 이어간다:', user.id, payment.id)
  }

  // 3. 계정 처리 — 잠금(refunded_at) → 30일 차감 또는 free 전환 → 자동 갱신 해지 → 강등 정리.
  //    상점관리자 취소 웹훅(/api/billing/webhook)과 같은 함수를 쓴다. 잠금이 먼저 걸리므로
  //    이 요청 직후 같은 건의 웹훅이 와도 계정이 두 번 차감되지 않는다.
  //    잠금 실패는 계정 무변경 — 재시도하면 토스가 '이미 취소됨'으로 답해 이 지점부터 다시 이어진다.
  const applied = await applyRefundToAccount(serviceClient, {
    paymentId: payment.id,
    userId: user.id,
    logTag: 'billing/refund',
  })
  if (!applied.ok) {
    const error = applied.stage === 'lock'
      ? 'refund_check_failed'
      : applied.stage === 'profile' ? 'profile_failed' : 'update_failed'
    return NextResponse.json({ error }, { status: 500 })
  }
  if (applied.alreadyApplied) {
    return NextResponse.json({ ok: true })
  }

  console.log(
    `[billing/refund] 환불 완료: user=${user.id} payment=${payment.id} amount=${payment.amount} ` +
    `expiresAfter=${applied.expiresAfter ?? 'free(즉시 종료)'}`,
  )

  return NextResponse.json({ ok: true })
}
