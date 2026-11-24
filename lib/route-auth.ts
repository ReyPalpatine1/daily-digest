// API 라우트 공용 인증 헬퍼.
// - cron 호출(CRON_SECRET Bearer) / 세션 사용자 / 관리자 판정을 한곳에 모은다.
// - Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
//   모든 환경변수는 함수 내부에서 읽는다.
// ※ share/feedback 라우트의 기존 getAuthedUser 사본은 회귀 방지를 위해 그대로 둔다.
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// cron(내부 스케줄러) 호출 여부 — Authorization: Bearer ${CRON_SECRET} 일치 시에만 true.
// CRON_SECRET 미설정이면 항상 false (빈 시크릿으로 통과하는 구멍 방지).
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// 세션 사용자 (쿠키 기반). 미로그인·오류면 null.
export async function getAuthedUser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const cookieStore = await cookies()
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // 무시
        }
      },
    },
  })
  const { data: { user }, error } = await authClient.auth.getUser()
  return error || !user ? null : user
}

// 가벼운 세션 확인 — 사용자 ID만 돌려준다. 미로그인·검증 실패·만료면 null.
// auth.getClaims()로 쿠키의 access token을 로컬 검증한다. 이 프로젝트는 비대칭 서명 키(ES256, JWKS)를
// 쓰므로 JWKS가 isolate 메모리에 캐시된 뒤에는 Supabase Auth 서버 왕복 없이 서명·만료를 확인한다.
// (대칭키 토큰이면 supabase-js가 스스로 getUser()로 폴백한다 — 정확성은 유지)
// ※ 세션 철회가 즉시 반영되지 않으므로(토큰 만료까지 유효) 공개 데이터만 돌려주는 경로에서만 쓸 것
//   (현재 /api/channels/resolve 전용). 다른 API는 getAuthedUser를 그대로 쓴다.
export async function getAuthedUserIdFast(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const cookieStore = await cookies()
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // 무시
        }
      },
    },
  })
  try {
    const { data, error } = await authClient.auth.getClaims()
    const claims = data?.claims
    if (error || !claims) return null
    // 로그인 사용자 토큰만 허용(anon 키 토큰 등 제외). aud는 Supabase 기본값 'authenticated'.
    const aud = claims.aud
    const audOk = Array.isArray(aud) ? aud.includes('authenticated') : aud === 'authenticated'
    if (!audOk || claims.role !== 'authenticated') return null
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : null
  } catch {
    // 토큰 원문·오류 상세는 남기지 않는다.
    return null
  }
}

// 관리자 이메일 여부 (ADMIN_EMAILS 쉼표 목록, 대소문자 무시).
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return adminEmails.includes(email.trim().toLowerCase())
}
