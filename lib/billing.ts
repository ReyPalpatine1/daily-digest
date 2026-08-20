// 토스 결제 공통 유틸 (서버 전용)
// ⚠️ TOSS_SECRET_KEY 를 다루므로 클라이언트 컴포넌트에서 import 금지.
//
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 처리 시점에 채워짐)
// 시크릿은 반드시 함수 내부에서 읽는다.

// 금액·상품명은 서버 상수다. 클라이언트가 보낸 값이나 환경변수로 대체하지 말 것
// — 금액을 바깥에서 정하게 하면 위변조 결제가 가능해진다.
export const PRICE_MONTHLY = 4900
export const ORDER_NAME = 'Daily Video Digest Pro 1개월'

export const TOSS_API = 'https://api.tosspayments.com/v1'

// 30일 = 한 이용 주기.
export const PERIOD_DAYS = 30

export type PaymentKind = 'auto' | 'onetime'

// 토스 REST 공통 Basic 인증 헤더.
// Workers에는 Buffer가 없으므로 btoa를 쓴다. 시크릿은 호출 시점에 읽는다.
// 미설정이면 null — 호출부가 500으로 끊고 로그를 남긴다(시크릿 값 자체는 절대 로그 금지).
export function tossAuthHeader(): string | null {
  const secret = process.env.TOSS_SECRET_KEY
  if (!secret) return null
  return `Basic ${btoa(`${secret}:`)}`
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
  code?: string
  message?: string
}
