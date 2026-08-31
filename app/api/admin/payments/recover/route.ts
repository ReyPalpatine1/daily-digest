import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { applyPaidPlan } from '@/lib/plan-sync'

// 결제 수동 복구 — "결제는 성공했는데 Pro가 안 켜진" 계정을 결제 기록대로 되돌린다.
//
// ★ 화면이 보낸 판정(needsRecovery)을 믿지 않는다. 화면은 캐시된 목록을 보고 있을 수 있고,
//   이건 남의 플랜을 바꾸는 요청이라 서버에서 전 조건을 다시 확인한다.
// ★ 날짜 계산을 여기서 새로 짜지 않는다. applyPaidPlan이 만료일 계산·채널 복구·
//   갱신 실패 카운터 초기화를 이미 다 하므로, 결제 경로와 복구 경로가 어긋나지 않게 그대로 호출한다.

export async function POST(request: Request) {
  // 관리자 권한 확인 — 기존 admin 라우트와 동일 패턴.
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 핸들러 안에서 읽는다.
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const cookieStore = await cookies()
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // 무시
        }
      },
    },
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser()

  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminEmail = user.email.toLowerCase()
  if (!adminEmails.includes(adminEmail)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const body = await request.json().catch(() => ({})) as { paymentId?: string }
  const { paymentId } = body
  if (!paymentId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  // 1. 결제 조회
  const { data: payment, error: paymentError } = await serviceClient
    .from('payments')
    .select('id, user_id, kind, status, created_at, recovered_at, refunded_at')
    .eq('id', paymentId)
    .maybeSingle()
  if (paymentError) {
    console.error('[admin/payments/recover] 결제 조회 실패:', paymentError.message)
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!payment) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 2. 승인된 결제만 복구 대상이다.
  if (payment.status !== 'done') {
    return NextResponse.json({ error: 'not_paid' }, { status: 400 })
  }

  // 3. 이중 적용 잠금 — 복구는 30일을 새로 붙이므로 두 번 누르면 60일이 된다.
  if (payment.recovered_at) {
    return NextResponse.json({ error: 'already_recovered' }, { status: 409 })
  }

  // 3-1. 환불한 결제는 복구 대상이 아니다.
  //      환불로 내린 계정은 "결제는 성공인데 지금 무료"라 Pro 전환 실패와 구분되지 않는다.
  //      화면(needsRecovery)이 이미 걸러내지만, 이 요청은 남의 플랜을 바꾸므로 서버도 막는다 —
  //      복구하면 돈은 돌려준 채 Pro를 다시 주게 된다.
  if (payment.refunded_at) {
    return NextResponse.json({ error: 'refunded' }, { status: 409 })
  }

  // 4. 프로필 조회
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id, email, plan, plan_expires_at')
    .eq('id', payment.user_id)
    .maybeSingle()
  if (profileError) {
    console.error('[admin/payments/recover] 프로필 조회 실패:', profileError.message)
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }
  if (!profile) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // 5. VIP는 덮어쓰지 않는다 — vip_granted_by/at이 지워져 되돌리기 어렵다.
  if (profile.plan === 'vip') {
    return NextResponse.json({ error: 'vip' }, { status: 409 })
  }

  // 6. 이미 반영된 결제인지 — 만료일이 결제일보다 미래면 플랜에 이미 들어가 있다.
  //    이 검사가 없으면 버튼을 두 번 눌러 30일이 두 번 붙는다.
  const paidMs = Date.parse(payment.created_at as string)
  const expiresMs = profile.plan_expires_at ? Date.parse(profile.plan_expires_at as string) : NaN
  if (!Number.isNaN(expiresMs) && !Number.isNaN(paidMs) && expiresMs > paidMs) {
    return NextResponse.json({ error: 'already_applied' }, { status: 409 })
  }

  // === 적용 종류 결정 ===
  // 카드가 없는데 'active'(자동 갱신)로 만들면 다음 갱신일에 결제가 실패해 사용자가 강등된다.
  // 고치는 행위가 새 사고를 만드는 셈이다. 카드 삭제 시 시스템이 1개월권으로 전환하는 것과 같은 규칙.
  const { data: billingKey, error: billingKeyError } = await serviceClient
    .from('billing_keys')
    .select('user_id')
    .eq('user_id', payment.user_id)
    .maybeSingle()
  if (billingKeyError) {
    console.error('[admin/payments/recover] 빌링키 조회 실패:', billingKeyError.message)
  }
  const hasCard = !!billingKey
  const appliedKind: 'auto' | 'onetime' = payment.kind === 'auto' && hasCard ? 'auto' : 'onetime'
  const downgradedToOnetime = payment.kind === 'auto' && !hasCard

  // === 적용 ===
  let expiresAt: string
  try {
    expiresAt = await applyPaidPlan(payment.user_id as string, appliedKind)
  } catch (e) {
    console.error('[admin/payments/recover] 플랜 반영 실패:', payment.user_id, e)
    return NextResponse.json({ error: 'apply_failed' }, { status: 500 })
  }

  // 복구 이력 기록. 플랜은 이미 반영됐으므로 여기서 실패해도 되돌리지 않고 로그만 남긴다
  // (되돌리면 사용자가 방금 받은 Pro를 다시 잃는다). 대신 잠금이 안 걸린 상태를 눈에 띄게 남긴다.
  const { error: markError } = await serviceClient
    .from('payments')
    .update({ recovered_at: new Date().toISOString(), recovered_by: adminEmail })
    .eq('id', paymentId)
  if (markError) {
    console.error(
      `[admin/payments/recover] ⚠️ 복구 이력 기록 실패(플랜은 반영됨 — 재복구 잠금 없음): payment=${paymentId} user=${payment.user_id}:`,
      markError.message,
    )
  }

  console.log(
    `[admin/payments/recover] 복구 실행: admin=${adminEmail} user=${payment.user_id} ` +
    `payment=${paymentId} kind=${appliedKind}${downgradedToOnetime ? '(auto→onetime: 카드 없음)' : ''} expires=${expiresAt}`
  )

  return NextResponse.json({ ok: true, appliedKind, expiresAt, downgradedToOnetime })
}
