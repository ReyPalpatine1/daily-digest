import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { applyPaidPlan } from '@/lib/plan-sync'
import {
  PRICE_MONTHLY,
  ORDER_NAME,
  TOSS_API,
  makeOrderId,
  tossAuthHeader,
  type TossPaymentResponse,
} from '@/lib/billing'

// 자동 갱신(빌링키) 결제 — 등록된 카드로 즉시 1개월분을 청구한다.
//
// 설계 메모
// - body를 받지 않는다. 금액·상품명은 서버 상수다(클라이언트가 정하면 위변조 결제가 된다).
// - orderId도 서버가 만든다. payments.order_id가 unique라 그 값이 멱등성 키가 된다.
// - payments에 pending을 "먼저" 넣고 승인 요청을 보낸다 —
//   승인은 됐는데 우리 기록이 없는 상태(가장 수습하기 어려운 상태)를 막기 위해서다.
// - 이미 이용 중(active + 만료 전)이면 중복 청구를 막고 409로 끊는다.
//
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 env는 핸들러 안에서 읽는다.

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = tossAuthHeader()
  if (!authHeader) {
    console.error('[billing/charge] TOSS_SECRET_KEY 미설정')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 1) 중복 결제 차단 — 이미 유효한 이용 기간이 있으면 청구하지 않는다.
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan, plan_status, plan_expires_at')
    .eq('id', user.id)
    .single()

  if (profile?.plan === 'vip') {
    return NextResponse.json({ error: 'vip' }, { status: 409 })
  }
  const notExpired =
    !!profile?.plan_expires_at && new Date(profile.plan_expires_at) > new Date()
  if (profile?.plan_status === 'active' && notExpired) {
    return NextResponse.json({ error: 'already_active' }, { status: 409 })
  }

  // 2) 빌링키 조회 — 카드가 없으면 결제 자체가 불가능하다.
  const { data: billing } = await serviceClient
    .from('billing_keys')
    .select('billing_key, customer_key')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!billing?.billing_key) {
    return NextResponse.json(
      { error: 'no_card', message: '카드를 먼저 등록해 주세요.' },
      { status: 400 }
    )
  }

  // 3) 주문 기록을 먼저 남긴다(pending).
  const orderId = makeOrderId(user.id, 'auto')
  const { error: insertError } = await serviceClient.from('payments').insert({
    user_id: user.id,
    order_id: orderId,
    amount: PRICE_MONTHLY,
    kind: 'auto',
    status: 'pending',
  })
  if (insertError) {
    console.error('[billing/charge] payments 기록 실패:', user.id, insertError.message)
    return NextResponse.json({ error: 'record_failed' }, { status: 500 })
  }

  // 4) 승인 요청.
  let toss: TossPaymentResponse
  try {
    const res = await fetch(`${TOSS_API}/billing/${billing.billing_key}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerKey: billing.customer_key,
        amount: PRICE_MONTHLY,
        orderId,
        orderName: ORDER_NAME,
      }),
    })
    toss = await res.json().catch(() => ({})) as TossPaymentResponse

    if (!res.ok || !toss.paymentKey) {
      console.error('[billing/charge] 승인 실패:', user.id, {
        status: res.status,
        code: toss.code ?? null,
        message: toss.message ?? null,
      })
      await serviceClient
        .from('payments')
        .update({
          status: 'failed',
          fail_code: toss.code ?? String(res.status),
          fail_message: toss.message ?? null,
        })
        .eq('order_id', orderId)
      return NextResponse.json(
        { error: toss.code ?? 'charge_failed', message: toss.message ?? null },
        { status: 400 }
      )
    }
  } catch (e) {
    console.error('[billing/charge] 토스 호출 실패:', user.id, e instanceof Error ? e.message : e)
    await serviceClient
      .from('payments')
      .update({ status: 'failed', fail_code: 'network_error' })
      .eq('order_id', orderId)
    return NextResponse.json({ error: 'network_error' }, { status: 502 })
  }

  // 5) 플랜 반영 → 기록 마감. 순서가 중요하다: 플랜을 먼저 켜야
  //    기록 업데이트가 실패해도 사용자는 결제한 만큼 쓸 수 있다.
  let planExpiresAt: string
  try {
    planExpiresAt = await applyPaidPlan(user.id, 'auto')
  } catch (e) {
    console.error('[billing/charge] 플랜 반영 실패(결제는 승인됨):', user.id, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'plan_sync_failed' }, { status: 500 })
  }

  const { error: doneError } = await serviceClient
    .from('payments')
    .update({
      status: 'done',
      payment_key: toss.paymentKey,
      receipt_url: toss.receipt?.url ?? null,
    })
    .eq('order_id', orderId)
  if (doneError) {
    // 결제·플랜은 이미 정상이다 — 기록만 어긋난 것이므로 실패로 응답하지 않는다.
    console.error('[billing/charge] payments 마감 실패:', user.id, doneError.message)
  }

  console.log('[billing/charge] 결제 완료:', user.id, orderId)
  return NextResponse.json({ ok: true, planExpiresAt, receiptUrl: toss.receipt?.url ?? null })
}
