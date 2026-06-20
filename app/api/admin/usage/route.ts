import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

type Service = 'gemini' | 'youtube' | 'supadata'

// 관리자 통계는 실시간일 필요 없음 → 60초 메모리 캐시(인증 통과 후 집계 결과에만 적용)
let cache: { at: number; payload: any } | null = null
const CACHE_TTL_MS = 60_000

function kstParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const map = Object.fromEntries(
    parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  ) as Record<string, string>
  return { year: map.year, month: map.month, day: map.day }
}

function todayKstDateString(): string {
  const { year, month, day } = kstParts(new Date())
  return `${year}-${month}-${day}`
}

function monthStartKstDateString(): string {
  const { year, month } = kstParts(new Date())
  return `${year}-${month}-01`
}

function daysAgoKstDateString(daysAgo: number): string {
  const todayString = todayKstDateString()
  const [y, m, d] = todayString.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - daysAgo)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export async function GET() {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안(요청 처리 시점)에서 읽는다. 최상단에서 읽으면 adminEmails가 빈 배열이 되어
  // 관리자 판정이 실패하고 403이 난다.
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
          // Route handler에서 응답이 이미 시작된 경우 등은 무시
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

  // 인증 통과 후, 신선한 캐시가 있으면 즉시 응답
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload)
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const today = todayKstDateString()
  const monthStart = monthStartKstDateString()
  const sevenDaysAgo = daysAgoKstDateString(6)
  const todayKstMidnightUtc = new Date(`${today}T00:00:00+09:00`).toISOString()
  const monthStartKstUtc = new Date(`${monthStart}T00:00:00+09:00`).toISOString()
  const weekAgoUtc = new Date(`${daysAgoKstDateString(6)}T00:00:00+09:00`).toISOString()

  // --- DB 응답 시간 측정용 ---
  const dbStart = Date.now()

  // === 서로 독립인 쿼리/집계 RPC를 병렬 실행 ===
  // api_usage 조회, profiles 조회, DAU/MAU/최신 digest/인기 채널 RPC
  // profiles 에 created_at / plan 컬럼이 없을 수 있어 방어적으로 조회
  const fetchProfiles = async (): Promise<{ profileRows: any[]; hasCreatedAt: boolean }> => {
    const res = await serviceClient
      .from('profiles')
      .select('id, email, created_at, plan')
      .order('created_at', { ascending: false })
    if (res.error) {
      const fallback = await serviceClient.from('profiles').select('id, email')
      return { profileRows: fallback.data ?? [], hasCreatedAt: false }
    }
    return { profileRows: res.data ?? [], hasCreatedAt: true }
  }

  const [apiUsageRes, profilesRes, dauRes, mauRes, latestDigestRes, topChannelsRes] = await Promise.all([
    // === API 사용량 (오늘+최근7일만 DB 집계 RPC) ===
    serviceClient.rpc('admin_usage_summary', { today_date: today, week_start: sevenDaysAgo }),
    fetchProfiles(),
    serviceClient.rpc('admin_active_users', { since: todayKstMidnightUtc }),
    serviceClient.rpc('admin_active_users', { since: monthStartKstUtc }),
    serviceClient.rpc('admin_latest_digest'),
    serviceClient.rpc('admin_top_channels'),
  ])

  const dbResponseMs = Date.now() - dbStart

  const rows = apiUsageRes.error ? [] : (apiUsageRes.data ?? [])
  const { profileRows, hasCreatedAt } = profilesRes

  const todayApi = {
    gemini: { count: 0, input: 0, output: 0 },
    youtube: { count: 0 },
    supadata: { count: 0 },
  }
  type DailyEntry = { date: string; gemini: number; youtube: number; supadata: number }
  const last7DaysMap = new Map<string, DailyEntry>()
  for (let i = 6; i >= 0; i--) {
    const d = daysAgoKstDateString(i)
    last7DaysMap.set(d, { date: d, gemini: 0, youtube: 0, supadata: 0 })
  }

  for (const row of rows ?? []) {
    const service = ((row as any).service ?? 'gemini') as Service
    const calls = Number((row as any).calls) || 0
    if ((row as any).date === today) {
      if (service === 'gemini') {
        todayApi.gemini.count += calls
        todayApi.gemini.input += Number((row as any).input_tokens) || 0
        todayApi.gemini.output += Number((row as any).output_tokens) || 0
      } else if (service === 'youtube') {
        todayApi.youtube.count += calls
      } else if (service === 'supadata') {
        todayApi.supadata.count += calls
      }
    }
    const entry = last7DaysMap.get((row as any).date)
    if (entry && (service === 'gemini' || service === 'youtube' || service === 'supadata')) {
      entry[service] += calls
    }
  }

  // === 사용자 통계 ===
  const totalUsers = profileRows.length
  // 결제 Pro와 VIP(무료) 분리 — 수익/전환율은 결제 Pro만 집계
  const proUsers = profileRows.filter(p => p.plan === 'pro' || p.plan === 'PRO').length
  const vipUsers = profileRows.filter(p => p.plan === 'vip').length
  const freeUsers = totalUsers - proUsers - vipUsers
  const proConversionRate = totalUsers > 0 ? Math.round((proUsers / totalUsers) * 1000) / 10 : 0

  let newToday = 0
  let newThisWeek = 0
  if (hasCreatedAt) {
    for (const p of profileRows) {
      if (!p.created_at) continue
      if (p.created_at >= todayKstMidnightUtc) newToday++
      if (p.created_at >= weekAgoUtc) newThisWeek++
    }
  }

  // 활동 사용자 (digests 기준) — DB 집계 RPC(고유 사용자 수)
  const dau = dauRes.error ? 0 : Number(dauRes.data) || 0
  const mau = mauRes.error ? 0 : Number(mauRes.data) || 0

  // === 시스템 상태 ===
  const cronLastRun = latestDigestRes.error ? null : (latestDigestRes.data ?? null)
  let cronStatus: 'healthy' | 'warning' | 'error' = 'error'
  if (cronLastRun) {
    const ageHours = (Date.now() - new Date(cronLastRun).getTime()) / 3_600_000
    cronStatus = ageHours <= 26 ? 'healthy' : ageHours <= 50 ? 'warning' : 'error'
  }

  // === 최근 가입자 ===
  const recentUsers = profileRows.slice(0, 10).map(p => {
    const raw = (p.plan ?? 'free').toString().toLowerCase()
    const plan = raw === 'pro' || raw === 'vip' ? raw : 'free'
    return {
      email: p.email ?? '-',
      plan,
      joinedAt: p.created_at ?? null,
    }
  })

  // === 인기 콘텐츠 (구독자 많은 채널) — DB 집계 RPC ===
  const topChannels = (topChannelsRes.error ? [] : topChannelsRes.data ?? []).map((c: any) => ({
    name: c.name,
    category: c.category ?? null,
    subscribers: Number(c.subscribers) || 0,
  }))

  const payload = {
    generatedAt: new Date().toISOString(),
    users: {
      total: totalUsers,
      free: freeUsers,
      pro: proUsers,
      vip: vipUsers,
      dau,
      mau,
      newToday,
      newThisWeek,
      proConversionRate,
      hasCreatedAt,
    },
    api: {
      gemini: { today: todayApi.gemini, limit: 1500 },
      youtube: { today: todayApi.youtube, limit: 10000 },
      supadata: { today: todayApi.supadata, limit: 100 },
    },
    revenue: {
      // 결제 시스템 미연동 — 0 placeholder
      subscription: { thisMonth: 0, lastMonth: 0 },
      affiliate: { thisMonth: 0, lastMonth: 0 },
      total: { thisMonth: 0, lastMonth: 0 },
      available: false,
    },
    system: {
      cronLastRun,
      cronStatus,
      sendSuccessRate: null, // 실패 추적 데이터 없음
      errors24h: null,       // 에러 추적 데이터 없음
      dbResponseMs,
    },
    recentUsers,
    topChannels,
    last7Days: Array.from(last7DaysMap.values()),
  }
  cache = { at: Date.now(), payload }
  return NextResponse.json(payload)
}
