import { supabase } from '@/lib/supabase'

// 공유 페이지(/s/[token]) → 랜딩(/?ref=share&t=...) 유입 표시 보관·기록.
//
// 구글 로그인은 외부(구글)로 나갔다 돌아오므로 탭 세션이 끊길 수 있다.
// → sessionStorage가 아니라 localStorage를 쓴다.
// 모든 접근은 try/catch — 스토리지가 막힌 브라우저(사파리 프라이빗 등)에서도 진입을 막지 않는다.

const REF_KEY = 'ddv_ref'
// 보관 유효기간 — 이 시간이 지난 값은 읽을 때 무시하고 삭제한다.
const REF_TTL_MS = 24 * 60 * 60 * 1000 // 24시간
// "최근에 생성된 프로필" 판정 폭 — 이보다 오래된 프로필은 기존 사용자로 보고 태깅하지 않는다.
const NEW_PROFILE_WINDOW_MS = 10 * 60 * 1000 // 10분

// URL에서 온 값이라 길이 상한을 둔다(비정상 값이 DB로 그대로 들어가지 않게).
const SOURCE_MAX = 32
const TOKEN_MAX = 64

export type SignupRef = { source: string; token: string | null; savedAt: number }

// 진입 URL 쿼리(?ref=...&t=...)에 유입 표시가 있으면 저장한다.
// ref가 없으면 아무것도 하지 않는다(기존 값을 덮어쓰지 않음).
export function captureSignupRef(search: string): void {
  try {
    const params = new URLSearchParams(search)
    const source = (params.get('ref') ?? '').trim().slice(0, SOURCE_MAX)
    if (!source) return
    const rawToken = (params.get('t') ?? '').trim().slice(0, TOKEN_MAX)
    const value: SignupRef = { source, token: rawToken || null, savedAt: Date.now() }
    localStorage.setItem(REF_KEY, JSON.stringify(value))
  } catch {}
}

// 보관된 유입 표시를 읽는다. 만료됐거나 형식이 깨졌으면 삭제하고 null.
export function readSignupRef(): SignupRef | null {
  try {
    const raw = localStorage.getItem(REF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SignupRef> | null
    const source = typeof parsed?.source === 'string' ? parsed.source.slice(0, SOURCE_MAX) : ''
    const savedAt = typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0
    if (!source || !savedAt || Date.now() - savedAt > REF_TTL_MS) {
      clearSignupRef()
      return null
    }
    const token = typeof parsed?.token === 'string' ? parsed.token.slice(0, TOKEN_MAX) : ''
    return { source, token: token || null, savedAt }
  } catch {
    clearSignupRef()
    return null
  }
}

export function clearSignupRef(): void {
  try { localStorage.removeItem(REF_KEY) } catch {}
}

// 로그인 후 1회 기록. 프로필이 보장된 직후(대시보드 초기 로드)에 호출한다.
//
// existing = 이번 진입에서 이미 있던 프로필 행(신규 생성이면 null).
// 기존 행은 signup_source가 비어 있고 "최근에 생성된" 경우에만 기록한다
// — 기존 사용자가 공유 링크를 타고 들어왔다고 태깅되면 안 된다.
//
// 기록 실패는 조용히 무시한다(로그인·대시보드 진입을 막지 않음).
export async function recordSignupRef(
  userId: string,
  existing: { signup_source?: string | null; created_at?: string | null } | null,
): Promise<void> {
  try {
    const ref = readSignupRef()
    if (!ref) return

    if (existing) {
      // 이미 기록된 프로필 — 표시는 소임을 다했으니 지운다.
      if (existing.signup_source) { clearSignupRef(); return }
      const createdAt = existing.created_at ? Date.parse(existing.created_at) : NaN
      // created_at을 못 읽으면(구환경 등) 신규 판정을 할 수 없으므로 기록하지 않는다.
      if (!Number.isFinite(createdAt)) return
      if (Date.now() - createdAt > NEW_PROFILE_WINDOW_MS) return
    }

    // 경쟁 상황(다른 탭 등)에서도 덮어쓰지 않도록 NULL일 때만 갱신.
    const { error } = await supabase
      .from('profiles')
      .update({ signup_source: ref.source, signup_ref_token: ref.token })
      .eq('id', userId)
      .is('signup_source', null)
    if (!error) clearSignupRef()
  } catch {}
}
