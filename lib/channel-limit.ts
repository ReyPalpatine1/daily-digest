// 플랜별 채널 한도 — 화면(대시보드)·채널 추가 API·enforceChannelLimit(강등·철회 경로)이
// 모두 이 파일 하나로 계산한다(서버·클라이언트 공용 순수 함수).
// 무료 = 기본 5개 + 광고성 정보 수신 동의 시 1개.
// Pro·VIP = 20개(동의 여부 무관). 요금제·결제·체험 종료 화면의 "구독 채널 20개"와 같은 값이다.
// ※ Pro 한도는 "새 추가"만 막는다 — 이미 20개를 넘게 가진 Pro 계정의 기존 채널은 건드리지 않는다.
export const FREE_CHANNEL_BASE = 5
export const AD_CONSENT_CHANNEL_BONUS = 1
export const PRO_CHANNEL_LIMIT = 20

export function freeChannelLimit(adConsent: boolean | null | undefined): number {
  return FREE_CHANNEL_BASE + (adConsent === true ? AD_CONSENT_CHANNEL_BONUS : 0)
}

// 플랜별 채널 한도. isPro는 호출부의 Pro 판정(Pro·VIP 포함) 결과를 그대로 넘긴다.
export function channelLimitFor(isPro: boolean, adConsent: boolean | null | undefined): number {
  return isPro ? PRO_CHANNEL_LIMIT : freeChannelLimit(adConsent)
}
