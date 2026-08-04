// 이메일 다이제스트 카드의 공유 링크(/dashboard?share=<videoId>) 진입 표시 보관·소비.
//
// 미로그인 상태로 열면 대시보드가 '/'로 리다이렉트하면서 쿼리가 사라진다.
// → 로그인 확인보다 먼저 저장해 두고, 로그인 후 대시보드에서 소비한다.
// 구글 로그인은 외부로 나갔다 돌아오므로 sessionStorage가 아니라 localStorage를 쓴다(signup-ref와 동일).
// 모든 접근은 try/catch — 스토리지가 막힌 브라우저(사파리 프라이빗 등)에서도 진입을 막지 않는다.

const SHARE_INTENT_KEY = 'ddv_share_intent'
// 보관 유효기간 — 이 시간이 지난 값은 읽을 때 무시하고 삭제한다.
const SHARE_INTENT_TTL_MS = 24 * 60 * 60 * 1000 // 24시간
// URL에서 온 값이라 길이 상한을 둔다(유튜브 video id는 11자).
const VIDEO_ID_MAX = 32

export type ShareIntent = { videoId: string; savedAt: number }

// 진입 URL 쿼리(?share=<videoId>)에 공유 대상이 있으면 저장한다.
// 저장했으면 true — 호출부가 URL에서 share 파라미터를 지울지 판단하는 데 쓴다.
// share가 없으면 아무것도 하지 않는다(기존 값을 덮어쓰지 않음).
export function captureShareIntent(search: string): boolean {
  try {
    const params = new URLSearchParams(search)
    const videoId = (params.get('share') ?? '').trim().slice(0, VIDEO_ID_MAX)
    if (!videoId) return false
    const value: ShareIntent = { videoId, savedAt: Date.now() }
    localStorage.setItem(SHARE_INTENT_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// 보관된 공유 대상을 읽는다. 만료됐거나 형식이 깨졌으면 삭제하고 null.
export function readShareIntent(): ShareIntent | null {
  try {
    const raw = localStorage.getItem(SHARE_INTENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ShareIntent> | null
    const videoId = typeof parsed?.videoId === 'string' ? parsed.videoId.slice(0, VIDEO_ID_MAX) : ''
    const savedAt = typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0
    if (!videoId || !savedAt || Date.now() - savedAt > SHARE_INTENT_TTL_MS) {
      clearShareIntent()
      return null
    }
    return { videoId, savedAt }
  } catch {
    clearShareIntent()
    return null
  }
}

export function clearShareIntent(): void {
  try { localStorage.removeItem(SHARE_INTENT_KEY) } catch {}
}
