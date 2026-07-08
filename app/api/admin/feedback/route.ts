import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 관리자 피드백 조회/상태변경 (feedback 최신순 + before 커서 페이지네이션)

const PAGE_SIZE = 50
const ALLOWED_STATUS = ['new', 'read', 'resolved'] as const

// 관리자 인증 — 기존 admin 라우트와 동일 패턴. env는 핸들러 안에서 읽는다(Cloudflare 호환).
// 인증 성공 시 { serviceClient } 반환, 실패 시 { response } 로 401/403 반환.
async function authAdmin(): Promise<
  | { serviceClient: SupabaseClient; response?: undefined }
  | { serviceClient?: undefined; response: NextResponse }
> {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

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
  const { data: { user }, error: userError } = await authClient.auth.getUser()

  if (userError || !user?.email) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!adminEmails.includes(user.email.toLowerCase())) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { serviceClient: createClient(supabaseUrl, supabaseServiceRoleKey) }
}

export async function GET(request: Request) {
  const auth = await authAdmin()
  if (auth.response) return auth.response
  const serviceClient = auth.serviceClient

  // before(ISO) 이전 것만 — "더 보기" 커서
  const { searchParams } = new URL(request.url)
  const before = searchParams.get('before')
  const type = searchParams.get('type') // all|general|bug|feature

  // user_id 가 profiles(id) 를 참조하므로 profiles 가 중첩으로 온다(탈퇴로 user_id=null이면 profiles=null).
  let query = serviceClient
    .from('feedback')
    .select('id, user_id, rating, type, message, status, locale, created_at, profiles(email, name)')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1) // hasMore 판별용 +1
  if (before) query = query.lt('created_at', before)
  if (type && type !== 'all') query = query.eq('type', type)

  const { data, error } = await query
  if (error) {
    console.error('[admin/feedback] 조회 실패:', error.message)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }

  const all = data ?? []
  const hasMore = all.length > PAGE_SIZE
  // profiles 중첩을 email/name 으로 평탄화 (profiles=null이면 둘 다 null).
  const rows = all.slice(0, PAGE_SIZE).map((row: any) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      id: row.id,
      user_id: row.user_id,
      rating: row.rating,
      type: row.type,
      message: row.message,
      status: row.status,
      locale: row.locale,
      created_at: row.created_at,
      email: profile?.email ?? null,
      name: profile?.name ?? null,
    }
  })

  return NextResponse.json({ rows, hasMore })
}

export async function PATCH(request: Request) {
  const auth = await authAdmin()
  if (auth.response) return auth.response
  const serviceClient = auth.serviceClient

  const body = await request.json().catch(() => ({})) as { id?: string; status?: string }
  const { id, status } = body

  if (!id || !ALLOWED_STATUS.includes(status as any)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const { error } = await serviceClient
    .from('feedback')
    .update({ status })
    .eq('id', id)

  if (error) {
    console.error('[admin/feedback] 상태 변경 실패:', error.message)
    return NextResponse.json({ error: '상태 변경 실패' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
