// 토스 카드 등록(빌링 인증) 요청 — 클라이언트 전용.
// ⚠️ 서버에서 import 금지: 토스 SDK는 브라우저에서만 동작한다(Workers에서 못 쓴다).
//
// /subscribe(구독 시작)와 /profile(카드 변경)이 같은 흐름을 쓰므로 여기 한 곳에 둔다.
// 카드 정보는 토스 결제창이 직접 받는다 — 우리 화면·서버는 카드번호를 만지지 않는다(PCI).
import { loadTossPayments } from '@tosspayments/tosspayments-sdk'

// 등록을 마친 뒤 무엇을 할지 — 결과 화면(/subscribe/billing-result)이 이 값으로 갈린다.
//   subscribe : 등록 직후 이어서 결제한다(구독 시작 흐름)
//   card      : 카드만 교체한다(결제하지 않는다)
export type BillingIntent = 'subscribe' | 'card'

// customerKey에는 로그인 사용자의 UUID를 그대로 넘긴다.
// 추측 불가·고유해야 하므로 이메일 같은 개인정보를 쓰지 말 것.
export async function requestCardRegistration(
  userId: string,
  intent: BillingIntent
): Promise<void> {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
  // NEXT_PUBLIC_ 변수는 빌드 시점에 번들로 들어간다 — 빌드 환경에 없으면 여기서 걸린다.
  if (!clientKey) throw new Error('missing_client_key')

  const toss = await loadTossPayments(clientKey)
  const origin = window.location.origin
  const returnUrl = `${origin}/subscribe/billing-result?intent=${intent}`
  await toss.payment({ customerKey: userId }).requestBillingAuth({
    method: 'CARD',
    successUrl: returnUrl,
    failUrl: `${returnUrl}&fail=1`,
  })
}

// ───────────────────────────────────────────────────────────────
// 결제 취소(환불) — 토스 빌링 심사 승인 후 연결한다.
//
// TODO: 토스 승인 후 연결. 지금은 실결제 0건이라 검증할 수 없어 자리만 비워 둔다.
//   붙일 때: POST https://api.tosspayments.com/v1/payments/{paymentKey}/cancel
//            body { cancelReason }, 헤더는 lib/billing.ts의 tossAuthHeader()를 쓴다.
//
// ★ 붙일 때 반드시 이 파일 밖으로 옮길 것. 이 모듈은 최상단에서 토스 브라우저 SDK를
//   import하므로 서버(Workers)에서 import하면 로드 단계에서 터진다. 취소는 서버에서만
//   호출해야 하는 동작이므로(시크릿 키 사용) lib/billing.ts 같은 서버 안전 모듈에 둔다.
//
// ★ 호출 순서: 취소가 성공한 뒤에만 계정 처리(플랜 차감)와 refunded_at 기록을 한다.
//   돈을 돌려주지 않고 계정만 내리면 최악의 사고다.
export async function cancelPayment(_paymentKey: string, _reason: string): Promise<void> {
  throw new Error('not_implemented')
}
