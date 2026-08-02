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

// 관리자 이메일 여부 (ADMIN_EMAILS 쉼표 목록, 대소문자 무시).
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return adminEmails.includes(email.trim().toLowerCase())
}
