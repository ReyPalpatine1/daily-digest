// 빌링키 결제 실행 (서버 전용) — 라우트(/api/billing/charge)와 cron(정기 갱신)이 같이 쓴다.
// ⚠️ TOSS_SECRET_KEY·SUPABASE_SERVICE_KEY 경로라 클라이언트에서 import 금지.
//
// 이 함수가 책임지는 범위는 "카드로 긁고 기록하고 플랜을 켜는 것"까지다.
// 누가 결제해도 되는지(중복 결제·해지 여부) 판단은 호출부가 한다 —
// 라우트는 사용자의 즉시 결제를, cron은 만료된 정기 갱신을 각각 다르게 따지기 때문이다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyPaidPlan } from './plan-sync'
import { PRICE_MONTHLY, ORDER_NAME, TOSS_API, tossAuthHeader, type TossPaymentResponse } from './billing'

export type ChargeResult =
  | { ok: true; planExpiresAt: string; receiptUrl: string | null }
  | { ok: false; code: string; message: string | null }

// orderId는 호출부가 만들어 넘긴다(auto_ / renew_ 접두로 유입 경로를 구분하기 위해서다).
// payments.order_id가 unique라 그 값이 곧 멱등성 키다.
export async function chargeWithBillingKey(
  client: SupabaseClient,
  userId: string,
  orderId: string,
  logTag: string
): Promise<ChargeResult> {
  const authHeader = tossAuthHeader()
  if (!authHeader) {
    console.error(`[${logTag}] TOSS_SECRET_KEY 미설정`)
    return { ok: false, code: 'not_configured', message: null }
  }

  // 1) 빌링키 — 카드가 지워졌으면 결제 자체가 불가능하다.
  const { data: billing } = await client
    .from('billing_keys')
    .select('billing_key, customer_key')
    .eq('user_id', userId)
    .maybeSingle()

  if (!billing?.billing_key) {
    return { ok: false, code: 'no_card', message: null }
  }

  // 2) 주문 기록을 먼저 남긴다(pending).
  //    승인은 됐는데 우리 기록이 없는 상태가 가장 수습하기 어렵다.
  const { error: insertError } = await client.from('payments').insert({
    user_id: userId,
    order_id: orderId,
    amount: PRICE_MONTHLY,
    kind: 'auto',
    status: 'pending',
  })
  if (insertError) {
    console.error(`[${logTag}] payments 기록 실패:`, userId, insertError.message)
    return { ok: false, code: 'record_failed', message: null }
  }

  // 3) 승인 요청.
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
      console.error(`[${logTag}] 승인 실패:`, userId, {
        status: res.status,
        code: toss.code ?? null,
        message: toss.message ?? null,
      })
      await client
        .from('payments')
        .update({
          status: 'failed',
          fail_code: toss.code ?? String(res.status),
          fail_message: toss.message ?? null,
        })
        .eq('order_id', orderId)
      return { ok: false, code: toss.code ?? 'charge_failed', message: toss.message ?? null }
    }
  } catch (e) {
    console.error(`[${logTag}] 토스 호출 실패:`, userId, e instanceof Error ? e.message : e)
    await client
      .from('payments')
      .update({ status: 'failed', fail_code: 'network_error' })
      .eq('order_id', orderId)
    return { ok: false, code: 'network_error', message: null }
  }

  // 4) 플랜을 먼저 켜고 기록을 마감한다 — 기록 실패가 이용에 영향을 주지 않게.
  let planExpiresAt: string
  try {
    planExpiresAt = await applyPaidPlan(userId, 'auto')
  } catch (e) {
    console.error(`[${logTag}] 플랜 반영 실패(결제는 승인됨):`, userId, e instanceof Error ? e.message : e)
    return { ok: false, code: 'plan_sync_failed', message: null }
  }

  const { error: doneError } = await client
    .from('payments')
    .update({
      status: 'done',
      payment_key: toss.paymentKey,
      receipt_url: toss.receipt?.url ?? null,
    })
    .eq('order_id', orderId)
  if (doneError) {
    // 결제·플랜은 이미 정상이다 — 기록만 어긋난 것이므로 실패로 보지 않는다.
    console.error(`[${logTag}] payments 마감 실패:`, userId, doneError.message)
  }

  console.log(`[${logTag}] 결제 완료:`, userId, orderId)
  return { ok: true, planExpiresAt, receiptUrl: toss.receipt?.url ?? null }
}
