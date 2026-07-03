import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 관리자 오류 로그 조회 (error_log 최신순 + before 커서 페이지네이션)

const PAGE_SIZE = 50

export async function GET(request: Request) {
  // 관리자 권한 확인 — 기존 admin 라우트와 동일 패턴.
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 핸들러 안에서 읽는다.
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!adminEmails.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // before(ISO) 이전 것만 — "더 보기" 커서
  const { searchParams } = new URL(request.url)
  const before = searchParams.get('before')

  let query = serviceClient
    .from('error_log')
    .select('id, occurred_at, source, video_id, video_title, channel_name, fail_reason, fail_detail')
    .order('occurred_at', { ascending: false })
    .limit(PAGE_SIZE + 1) // hasMore 판별용 +1
  if (before) query = query.lt('occurred_at', before)

  const { data, error } = await query
  if (error) {
    console.error('[admin/errors] 조회 실패:', error.message)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > PAGE_SIZE
  return NextResponse.json({ errors: rows.slice(0, PAGE_SIZE), hasMore })
}
