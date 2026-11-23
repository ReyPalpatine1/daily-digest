// 채널 URL 정규화 (중복 채널 판정 보조용)
// 끝 슬래시 / 쿼리 파라미터 / 프로토콜 / www 제거 후 소문자화.
// ⚠️ 쿼리를 지우므로 영상 주소(watch?v=)끼리는 모두 같아진다 → 입력 주소끼리 비교하지 말 것.
//    채널 추가(/api/channels)는 channel_id로 판정하고, channel_id가 없는 옛 행만
//    이 함수로 정식 채널 주소(youtube.com/channel/UC...)와 비교한다.
export function normalizeChannelUrl(url: string): string {
  return (url ?? '')
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, '')          // 쿼리 파라미터 제거
    .replace(/^https?:\/\//, '')   // 프로토콜 제거
    .replace(/^www\./, '')         // www 제거
    .replace(/\/$/, '')            // 끝 슬래시 제거
}
