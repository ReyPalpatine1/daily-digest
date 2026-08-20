import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { applyPaidPlan } from '@/lib/plan-sync'
import { TOSS_API, tossAuthHeader, type TossPaymentResponse } from '@/lib/billing'

// 1개월권(단건 결제) 승인 — 결제창에서 돌아온 paymentKey를 서버가 승인 처리한다.
//
// 방어 두 가지가 이 라우트의 핵심이다.
//  1) 금액 대조: 클라이언트가 보낸 amount를 믿지 않고 payments에 저장해 둔 금액과 맞춘다.
//     다르면 승인하지 않는다(토스 문서가 요구하는 필수 검증 — 금액 위변조 방지).
//     승인 요청에 실을 금액도 클라이언트 값이 아니라 저장된 값을 쓴다.
//  2) 멱등 처리: 이미 done인 주문은 재승인하지 않고 성공으로 돌려준다.
//     결과 화면에서 새로고침해도 두 번 결제되지 않는다.

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as
    { paymentKey?: string; orderId?: string; amount?: number | string } | null
  const paymentKey = body?.paymentKey
  const orderId = body?.orderId
  if (!paymentKey || !orderId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const authHeader = tossAuthHeader()
  if (!authHeader) {
    console.error('[billing/confirm] TOSS_SECRET_KEY 미설정')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: order } = await serviceClient
    .from('payments')
    .select('user_id, amount, status, kind')
    .eq('order_id', orderId)
    .maybeSingle()

  if (!order) {
    return NextResponse.json({ error: 'unknown_order' }, { status: 404 })
  }
  // 남의 주문을 자기 계정으로 승인시키는 것을 막는다.
  if (order.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 멱등 — 이미 승인된 주문이면 다시 승인하지 않는다(새로고침 대비).
  if (order.status === 'done') {
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('plan_expires_at')
      .eq('id', user.id)
      .single()
    return NextResponse.json({ ok: true, planExpiresAt: profile?.plan_expires_at ?? null })
  }

  // 금액 위변조 검증 — 저장된 금액과 다르면 승인하지 않는다.
  const claimed = Number(body?.amount)
  if (!Number.isFinite(claimed) || claimed !== order.amount) {
    console.error('[billing/confirm] 금액 불일치:', user.id, {
      orderId,
      expected: order.amount,
      claimed: body?.amount ?? null,
    })
    await serviceClient
      .from('payments')
      .update({ status: 'failed', fail_code: 'AMOUNT_MISMATCH', fail_message: '결제 금액이 일치하지 않습니다.' })
      .eq('order_id', orderId)
    return NextResponse.json(
      { error: 'amount_mismatch', message: '결제 금액이 일치하지 않습니다.' },
      { status: 400 }
    )
  }

  let toss: TossPaymentResponse
  try {
    const res = await fetch(`${TOSS_API}/payments/confirm`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      // 금액은 저장된 값을 쓴다 — 클라이언트가 보낸 값은 위에서 대조용으로만 썼다.
      body: JSON.stringify({ paymentKey, orderId, amount: order.amount }),
    })
    toss = await res.json().catch(() => ({})) as TossPaymentResponse

    if (!res.ok || !toss.paymentKey) {
      console.error('[billing/confirm] 승인 실패:', user.id, {
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
        { error: toss.code ?? 'confirm_failed', message: toss.message ?? null },
        { status: 400 }
      )
    }
  } catch (e) {
    console.error('[billing/confirm] 토스 호출 실패:', user.id, e instanceof Error ? e.message : e)
    await serviceClient
      .from('payments')
      .update({ status: 'failed', fail_code: 'network_error' })
      .eq('order_id', orderId)
    return NextResponse.json({ error: 'network_error' }, { status: 502 })
  }

  // 플랜을 먼저 켜고 기록을 마감한다 — 기록 실패가 이용에 영향을 주지 않게.
  let planExpiresAt: string
  try {
    planExpiresAt = await applyPaidPlan(user.id, 'onetime')
  } catch (e) {
    console.error('[billing/confirm] 플랜 반영 실패(결제는 승인됨):', user.id, e instanceof Error ? e.message : e)
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
    console.error('[billing/confirm] payments 마감 실패:', user.id, doneError.message)
  }

  console.log('[billing/confirm] 결제 완료:', user.id, orderId)
  return NextResponse.json({ ok: true, planExpiresAt, receiptUrl: toss.receipt?.url ?? null })
}
