import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 관리자 공유 신고 조회/상태변경/조치 (share_reports 최신순 + before 커서 페이지네이션)
// 인증·페이지네이션 패턴은 app/api/admin/feedback/route.ts와 동일하게 맞췄다.

const PAGE_SIZE = 50
const ALLOWED_STATUS = ['new', 'read', 'resolved'] as const
const ALLOWED_REASON = ['abuse', 'privacy', 'other'] as const
const ALLOWED_ACTION = ['clear_comment', 'block', 'unblock'] as const
// 누적 신고 수 집계용 상한 — 한 페이지(최대 50토큰)에 걸린 신고 행만 모아 세므로 넉넉한 값.
const REPORT_COUNT_SCAN_LIMIT = 5000

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

// 토큰 형식 방어 — app/api/share-report/route.ts와 동일 규칙(0-9a-z 8~32자).
function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-z]{8,32}$/.test(token)
}

type ShareReportRow = {
  id: string
  token: string
  video_id: string | null
  shared_by: string | null
  comment_snapshot: string | null
  reason: string
  detail: string | null
  status: string
  created_at: string
}

export async function GET(request: Request) {
  const auth = await authAdmin()
  if (auth.response) return auth.response
  const serviceClient = auth.serviceClient

  // before(ISO) 이전 것만 — "더 보기" 커서
  const { searchParams } = new URL(request.url)
  const before = searchParams.get('before')
  const reason = searchParams.get('reason') // all|abuse|privacy|other

  let query = serviceClient
    .from('share_reports')
    .select('id, token, video_id, shared_by, comment_snapshot, reason, detail, status, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1) // hasMore 판별용 +1
  if (before) query = query.lt('created_at', before)
  if (reason && reason !== 'all' && ALLOWED_REASON.includes(reason as any)) {
    query = query.eq('reason', reason)
  }

  const { data, error } = await query
  if (error) {
    console.error('[admin/reports] 조회 실패:', error.message)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }

  const all = (data ?? []) as ShareReportRow[]
  const hasMore = all.length > PAGE_SIZE
  const page = all.slice(0, PAGE_SIZE)

  // 부가 정보는 별도 조회로 붙인다(PostgREST 임베드 대신 — lib/share.ts getShareByToken과 같은 방식).
  // 조회 실패는 목록 자체를 막지 않고 해당 필드만 비운다.
  const tokens = Array.from(new Set(page.map(r => r.token).filter(Boolean)))
  const videoIds = Array.from(new Set(page.map(r => r.video_id).filter((v): v is string => !!v)))
  const sharedBys = Array.from(new Set(page.map(r => r.shared_by).filter((v): v is string => !!v)))

  const shareMap = new Map<string, { comment: string | null; blocked_at: string | null; expires_at: string | null }>()
  const videoTitleMap = new Map<string, string | null>()
  const profileMap = new Map<string, { email: string | null; name: string | null }>()
  const reportCountMap = new Map<string, number>()

  if (tokens.length > 0) {
    const { data: shareRows, error: shareError } = await serviceClient
      .from('shared_summaries')
      .select('token, comment, blocked_at, expires_at')
      .in('token', tokens)
    if (shareError) {
      console.error('[admin/reports] 공유 현황 조회 실패:', shareError.message)
    } else {
      for (const row of (shareRows ?? []) as { token: string; comment: string | null; blocked_at: string | null; expires_at: string | null }[]) {
        shareMap.set(row.token, {
          comment: row.comment ?? null,
          blocked_at: row.blocked_at ?? null,
          expires_at: row.expires_at ?? null,
        })
      }
    }

    // 같은 token 누적 신고 수 — 이 페이지에 걸린 토큰들의 신고 행만 모아 센다.
    const { data: countRows, error: countError } = await serviceClient
      .from('share_reports')
      .select('token')
      .in('token', tokens)
      .limit(REPORT_COUNT_SCAN_LIMIT)
    if (countError) {
      console.error('[admin/reports] 누적 신고 수 조회 실패:', countError.message)
    } else {
      for (const row of (countRows ?? []) as { token: string }[]) {
        reportCountMap.set(row.token, (reportCountMap.get(row.token) ?? 0) + 1)
      }
    }
  }

  if (videoIds.length > 0) {
    const { data: videoRows, error: videoError } = await serviceClient
      .from('videos')
      .select('video_id, title')
      .in('video_id', videoIds)
    if (videoError) {
      console.error('[admin/reports] 영상 제목 조회 실패:', videoError.message)
    } else {
      for (const row of (videoRows ?? []) as { video_id: string; title: string | null }[]) {
        videoTitleMap.set(row.video_id, row.title ?? null)
      }
    }
  }

  if (sharedBys.length > 0) {
    const { data: profileRows, error: profileError } = await serviceClient
      .from('profiles')
      .select('id, email, name')
      .in('id', sharedBys)
    if (profileError) {
      console.error('[admin/reports] 공유자 조회 실패:', profileError.message)
    } else {
      for (const row of (profileRows ?? []) as { id: string; email: string | null; name: string | null }[]) {
        profileMap.set(row.id, { email: row.email ?? null, name: row.name ?? null })
      }
    }
  }

  const rows = page.map(row => {
    const profile = row.shared_by ? profileMap.get(row.shared_by) : undefined
    return {
      id: row.id,
      token: row.token,
      video_id: row.video_id,
      shared_by: row.shared_by,
      comment_snapshot: row.comment_snapshot,
      reason: row.reason,
      detail: row.detail,
      status: row.status,
      created_at: row.created_at,
      video_title: row.video_id ? (videoTitleMap.get(row.video_id) ?? null) : null,
      shared_by_email: profile?.email ?? null,
      shared_by_name: profile?.name ?? null,
      // 이미 삭제(만료 정리)된 공유면 null — 화면에서 조치 버튼을 감춘다.
      share: shareMap.get(row.token) ?? null,
      report_count: reportCountMap.get(row.token) ?? 0,
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
    .from('share_reports')
    .update({ status })
    .eq('id', id)

  if (error) {
    console.error('[admin/reports] 상태 변경 실패:', error.message)
    return NextResponse.json({ error: '상태 변경 실패' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// 조치 실행 — 메모 삭제 / 링크 차단 / 차단 해제.
// 조치가 성공하면 해당 token의 미처리 신고를 일괄 resolved 처리한다.
export async function POST(request: Request) {
  const auth = await authAdmin()
  if (auth.response) return auth.response
  const serviceClient = auth.serviceClient

  const body = await request.json().catch(() => ({})) as { token?: string; action?: string }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const action = body.action

  if (!token || !isValidTokenFormat(token) || !ALLOWED_ACTION.includes(action as any)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const patch =
    action === 'clear_comment' ? { comment: null }
      : action === 'block' ? { blocked_at: new Date().toISOString() }
        : { blocked_at: null }

  const { data: updated, error } = await serviceClient
    .from('shared_summaries')
    .update(patch)
    .eq('token', token)
    .select('token, comment, blocked_at, expires_at')
    .maybeSingle()

  if (error) {
    console.error('[admin/reports] 조치 실패:', error.message)
    return NextResponse.json({ error: '조치 실패' }, { status: 500 })
  }
  // 이미 삭제·정리된 공유 — 조치할 대상이 없다.
  if (!updated) {
    return NextResponse.json({ error: 'share_not_found' }, { status: 404 })
  }

  // 신고 일괄 처리 — 실패해도 조치 자체는 이미 반영됐으므로 200으로 응답하고 resolved=false만 알린다.
  const { error: resolveError } = await serviceClient
    .from('share_reports')
    .update({ status: 'resolved' })
    .eq('token', token)
    .neq('status', 'resolved')
  if (resolveError) {
    console.error('[admin/reports] 신고 일괄 처리 실패:', resolveError.message)
  }

  const share = updated as { comment: string | null; blocked_at: string | null; expires_at: string | null }

  return NextResponse.json({
    ok: true,
    resolved: !resolveError,
    share: {
      comment: share.comment ?? null,
      blocked_at: share.blocked_at ?? null,
      expires_at: share.expires_at ?? null,
    },
  })
}
