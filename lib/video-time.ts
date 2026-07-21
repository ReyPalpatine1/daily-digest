// timeline 시각("m:ss" | "mm:ss" | "h:mm:ss") → 유튜브 딥링크 헬퍼.
// 이메일(email-templates.ts)·텔레그램(telegram.ts) 렌더 공용 (순수 함수, 의존성 없음).

// "7:52" → 472, "1:05:30" → 3930. 형식이 안 맞으면 0.
export function timeToSeconds(time: string): number {
  const m = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(String(time ?? '').trim())
  if (!m) return 0
  const a = Number(m[1])
  const b = Number(m[2])
  return m[3] !== undefined ? a * 3600 + b * 60 + Number(m[3]) : a * 60 + b
}

// 영상 URL에 t={seconds}s 파라미터 추가. 이미 쿼리가 있으면 &t=, 없으면 ?t=.
export function withTimeParam(url: string, seconds: number): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}t=${seconds}s`
}

// url + 시각 문자열 → 딥링크. url이 없거나 시각 파싱 실패 시 null(호출부에서 링크 없이 폴백).
export function videoDeepLink(url: string | null | undefined, time: string): string | null {
  if (!url) return null
  if (!/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.test(String(time ?? '').trim())) return null
  return withTimeParam(url, timeToSeconds(time))
}
