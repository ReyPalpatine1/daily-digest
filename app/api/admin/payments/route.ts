import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 관리자 결제 조회 (payments 최신순 + before 커서 페이지네이션)
//
// 사용자용 app/api/billing/payments/route.ts와 달리 pending·canceled까지 전부 내려준다.
// 환불 문의 대응 자리라 "결제창을 닫아 쌓인 주문(pending)"인지 "승인 전에 막힌 주문(canceled)"인지
// 구분되어야 하기 때문이다. 이 라우트는 조회 전용이다 — 플랜 변경·환불·상태 수정을 하지 않는다.

const PAGE_SIZE = 50

// 결제 후 발송 건수 조회 상한. 페이지 50건이 모두 done이어도 사용자당 40건까지는 덮인다.
const SENT_LOG_LIMIT = 2000
// 요약(30일) 집계에서 훑을 done 결제 상한.
const SUMMARY_SCAN_LIMIT = 5000
// PostgREST .in() 은 id를 URL에 싣는다 — uuid 150개면 약 5.5KB로, 헤더 한도 안에 들어간다.
const IN_CHUNK = 150

const STATUSES = ['all', 'done', 'failed', 'pending', 'canceled'] as const
type StatusFilter = (typeof STATUSES)[number]

type PaymentRow = {
  id: string
  user_id: string
  order_id: string
  amount: number
  kind: string
  status: string
  receipt_url: string | null
  fail_code: string | null
  created_at: string
}

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

  const { searchParams } = new URL(request.url)
  const before = searchParams.get('before')            // ISO — "더 보기" 커서
  const statusParam = (searchParams.get('status') ?? 'all') as StatusFilter
  const status: StatusFilter = STATUSES.includes(statusParam) ? statusParam : 'all'
  const rawQuery = (searchParams.get('q') ?? '').trim()

  let query = serviceClient
    .from('payments')
    .select('id, user_id, order_id, amount, kind, status, receipt_url, fail_code, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1) // hasMore 판별용 +1
  if (status !== 'all') query = query.eq('status', status)
  if (before) query = query.lt('created_at', before)

  if (rawQuery) {
    // PostgREST의 .or() 구문은 쉼표·괄호가 값에 섞이면 조건 자체가 깨진다 → 쓸 문자만 남긴다.
    const q = rawQuery.replace(/[^a-zA-Z0-9@._-]/g, '')
    if (!q) {
      // 남는 문자가 없으면 이메일(ilike)로도 주문번호(eq)로도 매칭될 수 없다.
      // 여기서 조건을 걸지 않으면 전체 목록이 나와 검색 결과로 오인되므로, 매칭 0건이 되게 둔다.
      query = query.eq('order_id', rawQuery)
    } else {
      // 이메일 부분일치로 사용자를 먼저 찾고, 주문번호 정확일치와 OR로 묶는다.
      const { data: matchedProfiles, error: profileSearchError } = await serviceClient
        .from('profiles')
        .select('id')
        .ilike('email', `%${q}%`)
        .limit(50)
      if (profileSearchError) {
        console.error('[admin/payments] 사용자 검색 실패:', profileSearchError.message)
      }
      const ids = (matchedProfiles ?? []).map(row => row.id as string)
      query = ids.length
        ? query.or(`order_id.eq.${q},user_id.in.(${ids.join(',')})`)
        : query.eq('order_id', q)
    }
  }

  const { data, error } = await query
  if (error) {
    console.error('[admin/payments] 조회 실패:', error.message)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }

  const rows = (data ?? []) as PaymentRow[]
  const hasMore = rows.length > PAGE_SIZE
  const page = rows.slice(0, PAGE_SIZE)

  // === 사용자 정보 — 결제 행의 user_id를 모아 한 번에 조회(페이지당 최대 50명) ===
  type ProfileInfo = { email: string | null; plan: string | null; planStatus: string | null; planExpiresAt: string | null }
  const profileMap = new Map<string, ProfileInfo>()
  const userIds = [...new Set(page.map(row => row.user_id))]
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await serviceClient
      .from('profiles')
      .select('id, email, plan, plan_status, plan_expires_at')
      .in('id', userIds)
    if (profilesError) {
      console.error('[admin/payments] 프로필 조회 실패:', profilesError.message)
    }
    for (const row of profiles ?? []) {
      profileMap.set(row.id as string, {
        email: (row.email as string | null) ?? null,
        plan: (row.plan as string | null) ?? null,
        planStatus: (row.plan_status as string | null) ?? null,
        planExpiresAt: (row.plan_expires_at as string | null) ?? null,
      })
    }
  }

  // === 결제 후 발송 건수 ===
  // 환불 정책이 "결제 7일 내 + 다이제스트 미발송이면 전액"이라 이 숫자가 환불 가부를 가른다.
  // done이 아닌 결제는 애초에 청구가 없어 대상이 아니므로 null로 둔다.
  const doneRows = page.filter(row => row.status === 'done')
  const sentAfterMap = new Map<string, number>()
  if (doneRows.length > 0) {
    const doneUserIds = [...new Set(doneRows.map(row => row.user_id))]
    // 페이지 내 가장 오래된 done 결제보다 이전 발송은 어느 결제에도 세지지 않으므로 잘라낸다.
    const oldestPaidAt = doneRows.reduce(
      (oldest, row) => (row.created_at < oldest ? row.created_at : oldest),
      doneRows[0].created_at,
    )
    const { data: logs, error: logsError } = await serviceClient
      .from('email_logs')
      .select('user_id, sent_at')
      .in('user_id', doneUserIds)
      .eq('type', 'digest')
      .eq('status', 'success')
      .gt('sent_at', oldestPaidAt)
      .limit(SENT_LOG_LIMIT)
    if (logsError) {
      console.error('[admin/payments] 발송 로그 조회 실패:', logsError.message)
    }

    // 타임존 표기가 섞여도 안전하도록 문자열이 아니라 epoch ms로 비교한다.
    const sentMsByUser = new Map<string, number[]>()
    for (const log of logs ?? []) {
      const userId = log.user_id as string | null
      const sentAt = log.sent_at as string | null
      if (!userId || !sentAt) continue
      const ms = Date.parse(sentAt)
      if (Number.isNaN(ms)) continue
      const list = sentMsByUser.get(userId)
      if (list) list.push(ms)
      else sentMsByUser.set(userId, [ms])
    }
    for (const row of doneRows) {
      const paidMs = Date.parse(row.created_at)
      const list = sentMsByUser.get(row.user_id) ?? []
      sentAfterMap.set(row.id, Number.isNaN(paidMs) ? 0 : list.filter(ms => ms > paidMs).length)
    }
  }

  const payments = page.map(row => {
    const profile = profileMap.get(row.user_id)
    return {
      id: row.id,
      orderId: row.order_id,
      createdAt: row.created_at,
      amount: row.amount,
      kind: row.kind,
      status: row.status,
      receiptUrl: row.receipt_url ?? null,
      failCode: row.fail_code ?? null,
      // 프로필이 없으면(탈퇴 등) 사용자 정보는 전부 null이다.
      email: profile?.email ?? null,
      plan: profile?.plan ?? null,
      planStatus: profile?.planStatus ?? null,
      planExpiresAt: profile?.planExpiresAt ?? null,
      sentAfter: sentAfterMap.has(row.id) ? sentAfterMap.get(row.id)! : null,
    }
  })

  // === 요약(최근 30일) — 검색·필터와 무관한 별도 집계 ===
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [doneResult, failedResult] = await Promise.all([
    serviceClient
      .from('payments')
      .select('user_id, amount')
      .eq('status', 'done')
      .gte('created_at', since)
      .limit(SUMMARY_SCAN_LIMIT),
    serviceClient
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', since),
  ])
  if (doneResult.error) console.error('[admin/payments] 요약(성공) 집계 실패:', doneResult.error.message)
  if (failedResult.error) console.error('[admin/payments] 요약(실패) 집계 실패:', failedResult.error.message)

  const doneIn30 = (doneResult.data ?? []) as { user_id: string; amount: number }[]
  const summaryCount = doneIn30.length
  const summaryAmount = doneIn30.reduce((sum, row) => sum + (row.amount ?? 0), 0)

  // 결제됐는데 지금 free인 계정 수. reconcilePaidPlans가 알림만 보내고 자동 복구는 하지 않으므로
  // 확인 지점이 필요하다. 30일 창인 이유 = 그보다 오래되면 만료로 free인 것이 정상이다.
  const paidUserIds = [...new Set(doneIn30.map(row => row.user_id))]
  let summaryMismatch = 0
  for (let i = 0; i < paidUserIds.length; i += IN_CHUNK) {
    const chunk = paidUserIds.slice(i, i + IN_CHUNK)
    const { count, error: mismatchError } = await serviceClient
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .in('id', chunk)
      .eq('plan', 'free')
    if (mismatchError) {
      console.error('[admin/payments] 요약(불일치) 집계 실패:', mismatchError.message)
      continue
    }
    summaryMismatch += count ?? 0
  }

  return NextResponse.json({
    payments,
    hasMore,
    summary: {
      count: summaryCount,
      amount: summaryAmount,
      failed: failedResult.count ?? 0,
      mismatch: summaryMismatch,
    },
  })
}
