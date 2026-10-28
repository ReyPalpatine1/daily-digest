// 1개월권(일반결제) 사용 가능 여부 — 화면용 판정은 여기 한 곳.
//
// 1개월권은 토스 "일반결제" 계약의 키로 결제창을 연다. 자동 갱신(빌링) 계약과 상점이 달라
// 키도 따로다. 일반결제 키가 들어오기 전까지 1개월권은 "보이지만 고를 수 없는" 상태로 두고,
// 키를 넣고 재빌드하면 코드 수정 없이 열린다.
//
// NEXT_PUBLIC_ 변수는 빌드 시점에 번들로 들어간다 — process.env.NEXT_PUBLIC_…를 그대로 써야
// 치환된다(구조 분해·동적 키로 읽으면 빌드가 값을 넣지 못한다).
// 서버용 판정(시크릿 기준)은 lib/billing.ts의 isOnetimeAvailableOnServer.
export function tossPaymentClientKey(): string | null {
  return process.env.NEXT_PUBLIC_TOSS_PAYMENT_CLIENT_KEY || null
}

export function isOnetimeAvailableOnClient(): boolean {
  return !!tossPaymentClientKey()
}
