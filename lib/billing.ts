// 토스 결제 공통 유틸 (서버 전용)
// ⚠️ 토스 시크릿 키를 다루므로 클라이언트 컴포넌트에서 import 금지.
//
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 처리 시점에 채워짐)
// 시크릿은 반드시 함수 내부에서 읽는다.
//
// 토스 계약이 두 개라(상점 ID가 다르면 키도 다르다) 키도 두 벌이다.
//   billing : 자동결제(빌링) 계약 — 카드 등록·빌링키 결제(자동 갱신).
//             NEXT_PUBLIC_TOSS_CLIENT_KEY(빌드) / TOSS_SECRET_KEY(런타임)
//   payment : 일반결제 계약 — 결제창 단건 결제(1개월권).
//             NEXT_PUBLIC_TOSS_PAYMENT_CLIENT_KEY(빌드) / TOSS_PAYMENT_SECRET_KEY(런타임)
// 한 흐름에서 다른 계약의 키를 쓰면 토스가 거절한다 — 흐름마다 맞는 쪽을 고를 것.

// 금액·상품명은 서버 상수다. 클라이언트가 보낸 값이나 환경변수로 대체하지 말 것
// — 금액을 바깥에서 정하게 하면 위변조 결제가 가능해진다.
export const PRICE_MONTHLY = 4900
export const ORDER_NAME = 'Daily Video Digest Pro 1개월'

export const TOSS_API = 'https://api.tosspayments.com/v1'

// 30일 = 한 이용 주기.
export const PERIOD_DAYS = 30

export type PaymentKind = 'auto' | 'onetime'

export type TossContract = 'billing' | 'payment'

// 토스 REST 공통 Basic 인증 헤더 — 계약 종류(billing/payment)로 시크릿을 고른다.
// Workers에는 Buffer가 없으므로 btoa를 쓴다. 시크릿은 호출 시점에 읽는다.
// 미설정이면 null — 호출부가 끊고 로그를 남긴다(시크릿 값 자체는 절대 로그 금지).
export function tossAuthHeader(contract: TossContract): string | null {
  const secret = contract === 'billing'
    ? process.env.TOSS_SECRET_KEY
    : process.env.TOSS_PAYMENT_SECRET_KEY
  if (!secret) return null
  return `Basic ${btoa(`${secret}:`)}`
}

// 1개월권(일반결제) 사용 가능 여부 — 서버용 판정은 여기 한 곳.
// 일반결제 계약 시크릿이 런타임에 있어야 결제 승인·취소를 할 수 있다.
// 화면용 판정은 lib/onetime-availability.ts(클라이언트 키 기준)에 있다.
export function isOnetimeAvailableOnServer(): boolean {
  return !!process.env.TOSS_PAYMENT_SECRET_KEY
}

// 주문번호는 반드시 서버가 만든다 — 클라이언트가 보낸 orderId를 쓰면
// 남의 주문에 붙거나 금액이 다른 주문을 재사용당할 수 있다.
// payments.order_id가 unique라 이 값이 곧 멱등성 키가 된다.
export function makeOrderId(userId: string, kind: PaymentKind): string {
  const prefix = kind === 'auto' ? 'auto' : 'once'
  return `${prefix}_${userId.slice(0, 8)}_${Date.now()}`
}

// 토스 결제 응답에서 우리가 저장하는 값만 뽑는다(원문 전체를 저장·로깅하지 않는다).
export type TossPaymentResponse = {
  paymentKey?: string
  orderId?: string
  status?: string
  receipt?: { url?: string }
  method?: string // 결제수단 유형('카드', '간편결제' 등) — payments.method에 기록
  code?: string
  message?: string
}

// 결제 취소(환불) — 서버 전용. 시크릿은 결제 종류로 고른다(auto → 빌링, onetime → 일반결제).
//
// ★ 호출 순서: 취소가 성공한 뒤에만 계정 처리(플랜 차감)와 refunded_at 기록을 한다.
//   돈을 돌려주지 않고 계정만 내리면 최악의 사고다 — 실패는 ok:false로 돌려주고 호출부가 끊는다.
// ★ Idempotency-Key는 호출부가 결제 행 기준 고정값을 넘긴다. 같은 결제의 재시도·중복 요청이
//   토스에서 한 번만 처리되게 한다.
// ★ 이미 토스에서 취소된 결제(ALREADY_CANCELED_PAYMENT)는 성공으로 본다 —
//   앞선 시도가 취소까지는 마쳤는데 우리 쪽 기록 전에 끊긴 경우다.
// 로그에는 토스 에러 code/message만 남긴다(paymentKey·시크릿 금지).
export type CancelResult =
  | { ok: true; alreadyCanceled: boolean }
  | { ok: false; code: string; message: string | null }

export async function cancelTossPayment(params: {
  paymentKey: string
  kind: PaymentKind
  reason: string
  idempotencyKey: string
}): Promise<CancelResult> {
  const authHeader = tossAuthHeader(params.kind === 'auto' ? 'billing' : 'payment')
  if (!authHeader) return { ok: false, code: 'not_configured', message: null }

  try {
    const res = await fetch(`${TOSS_API}/payments/${encodeURIComponent(params.paymentKey)}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({ cancelReason: params.reason }),
    })
    const toss = await res.json().catch(() => ({})) as TossPaymentResponse
    if (res.ok) return { ok: true, alreadyCanceled: false }
    if (toss.code === 'ALREADY_CANCELED_PAYMENT') return { ok: true, alreadyCanceled: true }
    return { ok: false, code: toss.code ?? String(res.status), message: toss.message ?? null }
  } catch (e) {
    return { ok: false, code: 'network_error', message: e instanceof Error ? e.message : null }
  }
}
