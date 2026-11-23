// 무료 플랜 채널 한도 — 화면(대시보드)·채널 추가 API·enforceChannelLimit(강등·철회 경로)이
// 모두 이 함수 하나로 계산한다(서버·클라이언트 공용 순수 함수).
// 무료 = 기본 5개 + 광고성 정보 수신 동의 시 1개. Pro·VIP는 한도가 없다(동의 여부 무관).
export const FREE_CHANNEL_BASE = 5
export const AD_CONSENT_CHANNEL_BONUS = 1

export function freeChannelLimit(adConsent: boolean | null | undefined): number {
  return FREE_CHANNEL_BASE + (adConsent === true ? AD_CONSENT_CHANNEL_BONUS : 0)
}
