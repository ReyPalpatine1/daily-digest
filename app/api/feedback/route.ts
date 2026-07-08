import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { sendAdminFeedbackAlert } from '@/lib/admin-alert'

// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
// env는 이 함수를 호출하는 핸들러 안에서 읽어 넘긴다.
async function getAuthedUser(supabaseUrl: string, supabaseAnonKey: string) {
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

const ALLOWED_TYPES = ['general', 'bug', 'feature'] as const

// 사용자 피드백 제출 — 로그인 사용자만. service_role로 feedback insert 후 관리자 알림(비동기, 실패 무시).
export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser(supabaseUrl, supabaseAnonKey)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    rating?: number | null
    type?: string
    message?: string
    locale?: string
  }

  // message: 필수, trim 후 2~500자
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message || message.length < 2 || message.length > 500) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 })
  }

  // rating: 없거나 1~5 정수만 허용, 그 외는 null
  const rawRating = body.rating
  const rating =
    typeof rawRating === 'number' && Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5
      ? rawRating
      : null

  // type: 화이트리스트 외 값은 'general'로
  const type = ALLOWED_TYPES.includes(body.type as any) ? (body.type as string) : 'general'

  const locale = typeof body.locale === 'string' && body.locale ? body.locale : null

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  // status / is_public / created_at 은 DB 기본값 사용
  const { error: insertError } = await serviceClient
    .from('feedback')
    .insert({ user_id: user.id, rating, type, message, locale })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // 관리자 알림은 실패해도 사용자 응답엔 영향 없음.
  try {
    await sendAdminFeedbackAlert({ userEmail: user.email ?? '', rating, type, message })
  } catch (e) {
    console.error('[feedback] 관리자 알림 발송 실패:', e)
  }

  return NextResponse.json({ ok: true })
}
