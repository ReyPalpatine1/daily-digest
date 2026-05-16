import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

type Service = 'gemini' | 'youtube' | 'supadata'

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

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const today = todayKstDateString()
  const monthStart = monthStartKstDateString()
  const sevenDaysAgo = daysAgoKstDateString(6)
  const todayKstMidnightUtc = new Date(`${today}T00:00:00+09:00`).toISOString()
  const monthStartKstUtc = new Date(`${monthStart}T00:00:00+09:00`).toISOString()
  const weekAgoUtc = new Date(`${daysAgoKstDateString(6)}T00:00:00+09:00`).toISOString()

  // --- DB 응답 시간 측정용 ---
  const dbStart = Date.now()

  // === API 사용량 (이번 달 전체 한 번에 조회) ===
  const { data: rows } = await serviceClient
    .from('api_usage')
    .select('service, date, api_calls, input_tokens, output_tokens')
    .gte('date', monthStart)
    .order('date', { ascending: true })

  const dbResponseMs = Date.now() - dbStart

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
    const service = (row.service ?? 'gemini') as Service
    const calls = row.api_calls ?? 0
    if (row.date === today) {
      if (service === 'gemini') {
        todayApi.gemini.count += calls
        todayApi.gemini.input += row.input_tokens ?? 0
        todayApi.gemini.output += row.output_tokens ?? 0
      } else if (service === 'youtube') {
        todayApi.youtube.count += calls
      } else if (service === 'supadata') {
        todayApi.supadata.count += calls
      }
    }
    if (row.date >= sevenDaysAgo) {
      const entry = last7DaysMap.get(row.date)
      if (entry && (service === 'gemini' || service === 'youtube' || service === 'supadata')) {
        entry[service] += calls
      }
    }
  }

  // === 사용자 통계 ===
  // profiles 에 created_at / plan 컬럼이 없을 수 있어 방어적으로 조회
  let profileRows: any[] = []
  let hasCreatedAt = true
  {
    const res = await serviceClient
      .from('profiles')
      .select('id, email, created_at, plan')
      .order('created_at', { ascending: false })
    if (res.error) {
      hasCreatedAt = false
      const fallback = await serviceClient.from('profiles').select('id, email')
      profileRows = fallback.data ?? []
    } else {
      profileRows = res.data ?? []
    }
  }

  const totalUsers = profileRows.length
  const proUsers = profileRows.filter(p => p.plan === 'pro' || p.plan === 'PRO').length
  const freeUsers = totalUsers - proUsers
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

  // 활동 사용자 (digests 기준)
  const { data: todayDigests } = await serviceClient
    .from('digests')
    .select('user_id')
    .gte('created_at', todayKstMidnightUtc)
  const { data: monthDigests } = await serviceClient
    .from('digests')
    .select('user_id, created_at')
    .gte('created_at', monthStartKstUtc)

  const dau = new Set((todayDigests ?? []).map((d: any) => d.user_id)).size
  const mau = new Set((monthDigests ?? []).map((d: any) => d.user_id)).size

  // === 시스템 상태 ===
  const { data: latestDigest } = await serviceClient
    .from('digests')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
  const cronLastRun = latestDigest?.[0]?.created_at ?? null
  let cronStatus: 'healthy' | 'warning' | 'error' = 'error'
  if (cronLastRun) {
    const ageHours = (Date.now() - new Date(cronLastRun).getTime()) / 3_600_000
    cronStatus = ageHours <= 26 ? 'healthy' : ageHours <= 50 ? 'warning' : 'error'
  }

  // === 최근 가입자 ===
  const recentUsers = profileRows.slice(0, 10).map(p => ({
    email: p.email ?? '-',
    plan: (p.plan === 'pro' || p.plan === 'PRO') ? 'pro' : 'free',
    joinedAt: p.created_at ?? null,
  }))

  // === 인기 콘텐츠 (구독자 많은 채널) ===
  const { data: channelRows } = await serviceClient
    .from('channels')
    .select('alias, url, categories(name)')

  const channelMap = new Map<string, { name: string; category: string | null; subscribers: number }>()
  for (const ch of channelRows ?? []) {
    const key = (ch.url ?? ch.alias ?? '').trim() || ch.alias
    if (!key) continue
    const existing = channelMap.get(key)
    const categoryName = (ch as any).categories?.name ?? null
    if (existing) {
      existing.subscribers++
      if (!existing.category && categoryName) existing.category = categoryName
    } else {
      channelMap.set(key, {
        name: ch.alias ?? key,
        category: categoryName,
        subscribers: 1,
      })
    }
  }
  const topChannels = Array.from(channelMap.values())
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, 10)

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    users: {
      total: totalUsers,
      free: freeUsers,
      pro: proUsers,
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
  })
}
