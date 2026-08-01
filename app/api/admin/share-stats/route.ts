import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 관리자 공유 기능 집계 — 유효/전체 공유 수, 누적 조회수, 공유 경유 가입자, 최근 7일 생성 수.
// 광고 클릭 집계(app/api/admin/ad-clicks)와 동일한 인증·응답 패턴.
// 단, 여기서는 한 값의 조회가 실패해도 그 값만 0으로 두고 나머지는 반환한다(화면이 깨지지 않도록).

// 누적 조회수 합산용 상한 — PostgREST에 집계 함수가 열려 있지 않아 view_count를 모아 더한다.
// 만료 공유는 7일 뒤 물리 삭제(lib/share.ts cleanupExpiredShares)되므로 행 수는 작게 유지된다.
const VIEW_COUNT_SCAN_LIMIT = 10000

export async function GET() {
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

  const nowIso = new Date().toISOString()
  const weekAgoIso = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const shareCount = () => serviceClient.from('shared_summaries').select('*', { count: 'exact', head: true })

  const [alive, total, views, signups, recent7d] = await Promise.all([
    // 살아있는 공유 — 차단되지 않았고(blocked_at null) 만료 전(expires_at null 이거나 미래).
    // expires_at null을 유효로 보는 판정은 lib/share.ts getShareByToken과 동일.
    shareCount().is('blocked_at', null).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    shareCount(),
    serviceClient.from('shared_summaries').select('view_count').limit(VIEW_COUNT_SCAN_LIMIT),
    serviceClient.from('profiles').select('*', { count: 'exact', head: true }).eq('signup_source', 'share'),
    shareCount().gte('created_at', weekAgoIso),
  ])

  // 실패한 값만 0으로 두고 나머지는 그대로 반환한다.
  for (const [label, res] of [
    ['유효 공유', alive], ['전체 공유', total], ['누적 조회', views],
    ['공유 경유 가입', signups], ['최근 7일 공유', recent7d],
  ] as const) {
    if (res.error) console.error(`[admin/share-stats] ${label} 집계 실패:`, res.error.message)
  }

  const viewRows = (views.data ?? []) as { view_count: number | null }[]
  const totalViews = viewRows.reduce((sum, row) => sum + (row.view_count ?? 0), 0)

  return NextResponse.json({
    alive: alive.count ?? 0,
    total: total.count ?? 0,
    views: totalViews,
    signups: signups.count ?? 0,
    recent7d: recent7d.count ?? 0,
  })
}
