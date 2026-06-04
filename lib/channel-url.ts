// 채널 URL 정규화 (중복 채널 판정용)
// 끝 슬래시 / 쿼리 파라미터 / 프로토콜 / www 제거 후 소문자화.
// ⚠️ channel_id 는 추가 시점에 아직 없으므로(나중에 YouTube API로 채워짐)
//    추가 단계의 중복 판정은 정규화 URL 기준으로 한다.
export function normalizeChannelUrl(url: string): string {
  return (url ?? '')
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, '')          // 쿼리 파라미터 제거
    .replace(/^https?:\/\//, '')   // 프로토콜 제거
    .replace(/^www\./, '')         // www 제거
    .replace(/\/$/, '')            // 끝 슬래시 제거
}
