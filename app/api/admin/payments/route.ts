import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 관리자 결제 조회 (payments 최신순 + before 커서 페이지네이션)
//
// 사용자용 app/api/billing/payments/route.ts와 달리 pending·canceled까지 전부 내려준다.
// 환불 문의 대응 자리라 "결제창을 닫아 쌓인 주문(pending)"인지 "승인 전에 막힌 주문(canceled)"인지
// 구분되어야 하기 때문이다. 이 라우트는 조회 전용이다 — 플랜 변경은 recover/route.ts가 한다.

const PAGE_SIZE = 50
const DAY_MS = 24 * 60 * 60 * 1000
// 결제 1건의 유효 기간. applyPaidPlan의 PERIOD_DAYS와 같은 값이며, 여기서는
// "아직 살아 있는 결제인가"를 판정하는 데만 쓴다(플랜 계산은 하지 않는다).
const PERIOD_DAYS = 30

// 결제 후 발송 건수 조회 상한. 페이지 50건이 모두 done이어도 사용자당 40건까지는 덮인다.
const SENT_LOG_LIMIT = 2000
// 금액 합산을 위해 훑을 done 결제 상한.
const AMOUNT_SCAN_LIMIT = 10000
// 복구 후보(최근 30일 done)를 훑을 상한. 목록 필터와 mismatch 집계가 함께 쓴다.
const RECOVERY_SCAN_LIMIT = 1000
// PostgREST .in() 은 id를 URL에 싣는다 — uuid 150개면 약 5.5KB로, 헤더 한도 안에 들어간다.
const IN_CHUNK = 150

const STATUSES = ['all', 'done', 'failed', 'pending', 'canceled', 'recovery'] as const
type StatusFilter = (typeof STATUSES)[number]
const PERIODS = ['all', '30', '90', '365'] as const
type PeriodFilter = (typeof PERIODS)[number]

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
  recovered_at: string | null
  recovered_by: string | null
}

type ProfileInfo = {
  email: string | null
  plan: string | null
  planStatus: string | null
  planExpiresAt: string | null
}

// 카드(빌링키)가 등록된 user_id 집합. loadProfiles와 같은 이유로 청크로 나눈다.
// 복구 시 실제 적용 종류를 화면이 미리 계산하는 데 쓴다 — recover/route.ts가
// 카드 없는 auto 결제를 onetime으로 낮추기 때문에, 이 값이 없으면 확인창이
// 서버와 다른 종류를 안내하게 된다.
async function loadCardUserIds(
  serviceClient: SupabaseClient,
  userIds: string[],
): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const chunk = userIds.slice(i, i + IN_CHUNK)
    const { data, error } = await serviceClient
      .from('billing_keys')
      .select('user_id')
      .in('user_id', chunk)
    if (error) {
      // 실패해도 조회는 계속한다. 빠진 사용자는 hasCard=false로 남는데,
      // 그쪽이 안전하다 — 확인창이 1개월권이라 말하고 서버가 자동 갱신을
      // 적용하는 것보다, 그 반대가 덜 위험하다.
      console.error('[admin/payments] 빌링키 조회 실패:', error.message)
      continue
    }
    for (const row of data ?? []) set.add(row.user_id as string)
  }
  return set
}

const PAYMENT_COLUMNS =
  'id, user_id, order_id, amount, kind, status, receipt_url, fail_code, created_at, recovered_at, recovered_by'

// 프로필을 청크로 나눠 조회한다 — id가 많으면 .in()의 URL이 헤더 한도를 넘는다.
async function loadProfiles(
  serviceClient: SupabaseClient,
  userIds: string[],
): Promise<Map<string, ProfileInfo>> {
  const map = new Map<string, ProfileInfo>()
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const chunk = userIds.slice(i, i + IN_CHUNK)
    const { data, error } = await serviceClient
      .from('profiles')
      .select('id, email, plan, plan_status, plan_expires_at')
      .in('id', chunk)
    if (error) {
      console.error('[admin/payments] 프로필 조회 실패:', error.message)
      continue
    }
    for (const row of data ?? []) {
      map.set(row.id as string, {
        email: (row.email as string | null) ?? null,
        plan: (row.plan as string | null) ?? null,
        planStatus: (row.plan_status as string | null) ?? null,
        planExpiresAt: (row.plan_expires_at as string | null) ?? null,
      })
    }
  }
  return map
}

// "결제는 성공했는데 Pro가 안 켜진" 건인지 판정한다.
// 화면 표시와 mismatch 집계가 같은 함수를 쓰고, 복구 API도 서버에서 같은 조건을 다시 확인한다.
function isNeedsRecovery(row: PaymentRow, profile: ProfileInfo | undefined, nowMs: number): boolean {
  if (row.status !== 'done') return false
  if (row.recovered_at) return false
  const paidMs = Date.parse(row.created_at)
  if (Number.isNaN(paidMs)) return false
  // 이미 30일이 지난 결제는 free인 것이 정상이다.
  if (paidMs + PERIOD_DAYS * DAY_MS <= nowMs) return false
  // 프로필이 없으면(탈퇴) 되돌릴 대상이 없다. 관리자 지정 Pro·VIP는 만료일이 원래 없어 제외된다.
  if (!profile || profile.plan !== 'free') return false
  // 결제가 반영됐다면 만료일이 결제일보다 미래로 밀려 있어야 한다.
  if (!profile.planExpiresAt) return true
  const expiresMs = Date.parse(profile.planExpiresAt)
  if (Number.isNaN(expiresMs)) return true
  return expiresMs < paidMs
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
  const periodParam = (searchParams.get('period') ?? 'all') as PeriodFilter
  const period: PeriodFilter = PERIODS.includes(periodParam) ? periodParam : 'all'
  const rawQuery = (searchParams.get('q') ?? '').trim()

  const nowMs = Date.now()
  const periodStart = period === 'all' ? null : new Date(nowMs - Number(period) * DAY_MS).toISOString()
  const recoveryWindowStart = new Date(nowMs - PERIOD_DAYS * DAY_MS).toISOString()

  // === 검색 조건 ===
  // PostgREST의 .or() 구문은 쉼표·괄호가 값에 섞이면 조건 자체가 깨진다 → 쓸 문자만 남긴다.
  let searchFilter: { mode: 'none' } | { mode: 'orderId'; value: string } | { mode: 'or'; expr: string } = { mode: 'none' }
  if (rawQuery) {
    const q = rawQuery.replace(/[^a-zA-Z0-9@._-]/g, '')
    if (!q) {
      // 남는 문자가 없으면 이메일(ilike)로도 주문번호(eq)로도 매칭될 수 없다.
      // 여기서 조건을 걸지 않으면 전체 목록이 나와 검색 결과로 오인되므로, 매칭 0건이 되게 둔다.
      searchFilter = { mode: 'orderId', value: rawQuery }
    } else {
      const { data: matchedProfiles, error: profileSearchError } = await serviceClient
        .from('profiles')
        .select('id')
        .ilike('email', `%${q}%`)
        .limit(50)
      if (profileSearchError) {
        console.error('[admin/payments] 사용자 검색 실패:', profileSearchError.message)
      }
      const ids = (matchedProfiles ?? []).map(row => row.id as string)
      searchFilter = ids.length
        ? { mode: 'or', expr: `order_id.eq.${q},user_id.in.(${ids.join(',')})` }
        : { mode: 'orderId', value: q }
    }
  }

  let page: PaymentRow[] = []
  let hasMore = false
  let profileMap: Map<string, ProfileInfo>

  if (status === 'recovery') {
    // 복구 필요 판정은 JS에서 이뤄지므로(프로필과 대조해야 한다) DB 커서로는 자를 수 없다.
    // 판정 자체가 30일 창을 포함하므로 period는 무시하고 그 범위만 훑는다.
    let scanQuery = serviceClient
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .eq('status', 'done')
      .is('recovered_at', null)
      .gte('created_at', recoveryWindowStart)
      .order('created_at', { ascending: false })
      .limit(RECOVERY_SCAN_LIMIT)
    if (searchFilter.mode === 'or') scanQuery = scanQuery.or(searchFilter.expr)
    else if (searchFilter.mode === 'orderId') scanQuery = scanQuery.eq('order_id', searchFilter.value)

    const { data, error } = await scanQuery
    if (error) {
      console.error('[admin/payments] 복구 후보 조회 실패:', error.message)
      return NextResponse.json({ error: '조회 실패' }, { status: 500 })
    }
    const candidates = (data ?? []) as PaymentRow[]
    profileMap = await loadProfiles(serviceClient, [...new Set(candidates.map(row => row.user_id))])

    let filtered = candidates.filter(row => isNeedsRecovery(row, profileMap.get(row.user_id), nowMs))
    if (before) filtered = filtered.filter(row => row.created_at < before)
    hasMore = filtered.length > PAGE_SIZE
    page = filtered.slice(0, PAGE_SIZE)
  } else {
    let query = serviceClient
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE + 1) // hasMore 판별용 +1
    if (periodStart) query = query.gte('created_at', periodStart)
    if (status !== 'all') query = query.eq('status', status)
    if (before) query = query.lt('created_at', before)
    if (searchFilter.mode === 'or') query = query.or(searchFilter.expr)
    else if (searchFilter.mode === 'orderId') query = query.eq('order_id', searchFilter.value)

    const { data, error } = await query
    if (error) {
      console.error('[admin/payments] 조회 실패:', error.message)
      return NextResponse.json({ error: '조회 실패' }, { status: 500 })
    }
    const rows = (data ?? []) as PaymentRow[]
    hasMore = rows.length > PAGE_SIZE
    page = rows.slice(0, PAGE_SIZE)
    profileMap = await loadProfiles(serviceClient, [...new Set(page.map(row => row.user_id))])
  }

  // 카드 유무 — 목록 분기(recovery 포함) 두 갈래가 합류한 뒤라 한 번만 조회하면 된다.
  const cardUserIds = await loadCardUserIds(serviceClient, [...new Set(page.map(row => row.user_id))])

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
      needsRecovery: isNeedsRecovery(row, profile, nowMs),
      hasCard: cardUserIds.has(row.user_id),
      recoveredAt: row.recovered_at ?? null,
      recoveredBy: row.recovered_by ?? null,
    }
  })

  // === 집계 — 목록과 별개로 계산 ===
  const countQuery = serviceClient.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'done')
  const amountQuery = serviceClient.from('payments').select('amount').eq('status', 'done').limit(AMOUNT_SCAN_LIMIT)
  const failedQuery = serviceClient.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'failed')
  const [countResult, amountResult, failedResult] = await Promise.all([
    periodStart ? countQuery.gte('created_at', periodStart) : countQuery,
    periodStart ? amountQuery.gte('created_at', periodStart) : amountQuery,
    periodStart ? failedQuery.gte('created_at', periodStart) : failedQuery,
  ])
  if (countResult.error) console.error('[admin/payments] 집계(건수) 실패:', countResult.error.message)
  if (amountResult.error) console.error('[admin/payments] 집계(금액) 실패:', amountResult.error.message)
  if (failedResult.error) console.error('[admin/payments] 집계(실패) 실패:', failedResult.error.message)

  const summaryAmount = ((amountResult.data ?? []) as { amount: number }[])
    .reduce((sum, row) => sum + (row.amount ?? 0), 0)

  // mismatch만 period의 영향을 받지 않는다. "지금 처리해야 할 건"을 세는 값이라
  // 기간을 좁히면 처리할 건을 놓친다. 검색어도 적용하지 않는다.
  const { data: recoveryScan, error: recoveryScanError } = await serviceClient
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('status', 'done')
    .is('recovered_at', null)
    .gte('created_at', recoveryWindowStart)
    .order('created_at', { ascending: false })
    .limit(RECOVERY_SCAN_LIMIT)
  if (recoveryScanError) console.error('[admin/payments] 집계(복구 필요) 실패:', recoveryScanError.message)

  const recoveryCandidates = (recoveryScan ?? []) as PaymentRow[]
  const recoveryProfiles = await loadProfiles(serviceClient, [...new Set(recoveryCandidates.map(row => row.user_id))])
  const summaryMismatch = recoveryCandidates
    .filter(row => isNeedsRecovery(row, recoveryProfiles.get(row.user_id), nowMs))
    .length

  return NextResponse.json({
    payments,
    hasMore,
    summary: {
      count: countResult.count ?? 0,
      amount: summaryAmount,
      failed: failedResult.count ?? 0,
      mismatch: summaryMismatch,
    },
  })
}
