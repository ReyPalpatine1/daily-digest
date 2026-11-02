import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TOSS_API, tossAuthHeader, type TossPaymentResponse } from '@/lib/billing'
import { applyRefundToAccount } from '@/lib/refund-apply'

// 토스 웹훅 — PAYMENT_STATUS_CHANGED.
// 상점관리자에서 직접 취소(환불)한 결제를 계정에 반영한다. 프로필 환불과 같은 함수로 처리한다.
// (프로필 환불 직후 같은 건의 웹훅이 와도 refunded_at 잠금에 걸려 아무것도 하지 않는다)
//
// ★ 로그인 없이 토스 서버가 호출한다. 이 웹훅은 서명이 없어 누구나 위조해 보낼 수 있으므로
//   본문은 "어느 주문을 다시 확인할지"를 알려주는 힌트로만 쓴다.
//   ① orderId로 우리 결제 행을 찾고 ② 행의 kind에 맞는 시크릿으로 토스에 실제 상태를 다시 조회해
//   ③ 토스가 CANCELED라고 답할 때만 계정을 처리한다. 본문의 status는 보지 않는다.
// ★ 환불 자격(refund-eligibility)은 적용하지 않는다 — 운영자가 이미 결정해 돈을 돌려준 건이다.
// ★ 응답: 처리했거나 무시할 건은 200. 다시 받으면 처리될 수 있는 경우(토스 조회 실패·DB 오류)만
//   500 — 토스가 재전송한다. 10초 안에 응답해야 하므로 무거운 일은 하지 않는다.
// ★ 로그에는 payment id·order id·status·토스 에러 code/message만. paymentKey 원문·시크릿 금지.
//   응답 본문에도 정보를 담지 않는다.

const TOSS_LOOKUP_TIMEOUT_MS = 7000

type WebhookBody = {
  eventType?: unknown
  data?: { paymentKey?: unknown; orderId?: unknown } | null
}

const ok = () => NextResponse.json({ ok: true })
const retry = () => NextResponse.json({ ok: false }, { status: 500 })

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as WebhookBody | null
  if (!body || body.eventType !== 'PAYMENT_STATUS_CHANGED') return ok()

  const orderId = typeof body.data?.orderId === 'string' ? body.data.orderId : null
  const hintedPaymentKey = typeof body.data?.paymentKey === 'string' ? body.data.paymentKey : null
  if (!orderId) {
    console.warn('[billing/webhook] orderId 없는 이벤트 — 무시')
    return ok()
  }

  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 핸들러 안에서 읽는다.
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  // ① 우리 결제 행.
  const { data: row, error: rowError } = await serviceClient
    .from('payments')
    .select('id, user_id, kind, status, payment_key, order_id')
    .eq('order_id', orderId)
    .maybeSingle()

  if (rowError) {
    console.error(`[billing/webhook] 결제 조회 실패: order=${orderId}:`, rowError.message)
    return retry()
  }
  if (!row) {
    // 우리 결제가 아니거나(링크페이 등) 탈퇴로 payments_archive에 옮겨진 결제.
    console.warn(`[billing/webhook] 우리 결제 행 없음 — 무시: order=${orderId}`)
    return ok()
  }

  const paymentId = row.id as string
  const userId = row.user_id as string | null
  const kind = row.kind as string | null
  if (kind !== 'auto' && kind !== 'onetime') {
    console.warn(`[billing/webhook] 결제 종류 미상 — 무시: payment=${paymentId} order=${orderId} kind=${kind}`)
    return ok()
  }

  // ② 토스에 실제 상태 재조회. 저장된 paymentKey를 우선 쓴다(본문 값은 저장값이 없을 때만).
  const storedPaymentKey = (row.payment_key as string | null) ?? null
  const lookupKey = storedPaymentKey ?? hintedPaymentKey
  if (!lookupKey) {
    console.warn(`[billing/webhook] paymentKey 없음 — 무시: payment=${paymentId} order=${orderId}`)
    return ok()
  }

  const authHeader = tossAuthHeader(kind === 'auto' ? 'billing' : 'payment')
  if (!authHeader) {
    console.error(`[billing/webhook] 토스 시크릿 미설정(${kind}): payment=${paymentId} order=${orderId}`)
    return retry()
  }

  let toss: TossPaymentResponse
  try {
    const res = await fetch(`${TOSS_API}/payments/${encodeURIComponent(lookupKey)}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(TOSS_LOOKUP_TIMEOUT_MS),
    })
    toss = await res.json().catch(() => ({})) as TossPaymentResponse
    if (!res.ok) {
      console.error(`[billing/webhook] 토스 조회 실패: payment=${paymentId} order=${orderId}:`, {
        code: toss.code ?? String(res.status),
        message: toss.message ?? null,
      })
      return retry()
    }
  } catch (e) {
    console.error(`[billing/webhook] 토스 조회 실패(network): payment=${paymentId} order=${orderId}:`,
      e instanceof Error ? e.message : null)
    return retry()
  }

  // 조회 결과가 우리 행과 같은 결제인지 확인 — 본문에 남의 paymentKey를 넣은 위조를 막는다.
  if (toss.orderId !== row.order_id || (storedPaymentKey && toss.paymentKey !== storedPaymentKey)) {
    console.warn(`[billing/webhook] ⚠️ 조회 결과가 우리 결제와 불일치 — 무시: payment=${paymentId} order=${orderId}`)
    return ok()
  }

  const status = toss.status ?? null

  if (status === 'PARTIAL_CANCELED') {
    console.warn(`[billing/webhook] ⚠️ 부분 취소 — 수동 확인 필요: payment=${paymentId} order=${orderId} user=${userId}`)
    return ok()
  }
  if (status !== 'CANCELED') {
    // DONE 등 — 계정과 무관한 상태 변화.
    return ok()
  }

  // ③ 실제로 취소된 결제. 승인된 적 없는 주문(status != done)은 계정에 준 기간이 없으므로 건드리지 않는다.
  if (row.status !== 'done' || !userId) {
    console.warn(`[billing/webhook] 취소됐으나 승인 완료 결제가 아님 — 무시: payment=${paymentId} order=${orderId} status=${row.status}`)
    return ok()
  }

  const applied = await applyRefundToAccount(serviceClient, {
    paymentId,
    userId,
    logTag: 'billing/webhook',
  })
  if (!applied.ok) {
    // 잠금 전 실패만 재전송으로 처리될 수 있다. 잠근 뒤 실패는 재전송해도 잠금에 걸리므로 200
    // (수동 확인 로그는 applyRefundToAccount가 남겼다).
    return applied.stage === 'lock' ? retry() : ok()
  }
  if (!applied.alreadyApplied) {
    console.log(
      `[billing/webhook] 상점관리자 취소 반영: user=${userId} payment=${paymentId} order=${orderId} ` +
      `expiresAfter=${applied.expiresAfter ?? 'free(즉시 종료)'}`,
    )
  }
  return ok()
}
