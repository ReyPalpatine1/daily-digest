// timeline 시각("m:ss" | "mm:ss" | "h:mm:ss") → 유튜브 딥링크 헬퍼.
// 이메일(email-templates.ts)·텔레그램(telegram.ts) 렌더 공용 (순수 함수, 의존성 없음).

// "7:52" → 472, "1:05:30" → 3930. 콜론 split 후 뒤에서부터 초·분·시. 형식이 안 맞으면 0.
export function timeToSeconds(t: string): number {
  const parts = String(t ?? '').trim().split(':')
  if (parts.length < 2 || parts.length > 3) return 0
  let seconds = 0
  let mul = 1
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].trim()
    if (!/^\d+$/.test(p)) return 0
    seconds += Number(p) * mul
    mul *= 60
  }
  return seconds
}

// 영상 URL에 t={seconds}s 파라미터 추가. 이미 쿼리가 있으면 &t=, 없으면 ?t=.
// 초가 0(0:00 포함)이거나 파싱 실패면 원본 URL 그대로 반환(안전 폴백).
export function youtubeDeepLink(videoUrl: string, time: string): string {
  const seconds = timeToSeconds(time)
  if (!seconds) return videoUrl
  const sep = videoUrl.includes('?') ? '&' : '?'
  return `${videoUrl}${sep}t=${seconds}s`
}
