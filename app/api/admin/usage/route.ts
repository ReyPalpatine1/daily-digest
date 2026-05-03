import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

type Service = 'gemini' | 'youtube' | 'supadata'

type ServiceTotals = {
  gemini: { count: number; input_tokens: number; output_tokens: number }
  youtube: { count: number }
  supadata: { count: number }
}

function emptyTotals(): ServiceTotals {
  return {
    gemini: { count: 0, input_tokens: 0, output_tokens: 0 },
    youtube: { count: 0 },
    supadata: { count: 0 },
  }
}

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
  // 오늘 KST 자정으로부터 daysAgo일 전의 KST 날짜
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

  const today = todayKstDateString()
  const monthStart = monthStartKstDateString()
  const sevenDaysAgo = daysAgoKstDateString(6) // 오늘 포함 7일

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 이번 달 전체 데이터 한 번에 조회 후 클라이언트에서 분류
  const { data: rows, error } = await serviceClient
    .from('api_usage')
    .select('service, date, api_calls, input_tokens, output_tokens')
    .gte('date', monthStart)
    .order('date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const todayTotals = emptyTotals()
  const monthTotals = emptyTotals()

  type DailyEntry = { date: string; gemini: number; youtube: number; supadata: number }
  const last7DaysMap = new Map<string, DailyEntry>()
  for (let i = 6; i >= 0; i--) {
    const d = daysAgoKstDateString(i)
    last7DaysMap.set(d, { date: d, gemini: 0, youtube: 0, supadata: 0 })
  }

  for (const row of rows ?? []) {
    const service = (row.service ?? 'gemini') as Service
    const calls = row.api_calls ?? 0
    const input = row.input_tokens ?? 0
    const output = row.output_tokens ?? 0

    // month total
    if (service === 'gemini') {
      monthTotals.gemini.count += calls
      monthTotals.gemini.input_tokens += input
      monthTotals.gemini.output_tokens += output
    } else if (service === 'youtube') {
      monthTotals.youtube.count += calls
    } else if (service === 'supadata') {
      monthTotals.supadata.count += calls
    }

    // today total
    if (row.date === today) {
      if (service === 'gemini') {
        todayTotals.gemini.count += calls
        todayTotals.gemini.input_tokens += input
        todayTotals.gemini.output_tokens += output
      } else if (service === 'youtube') {
        todayTotals.youtube.count += calls
      } else if (service === 'supadata') {
        todayTotals.supadata.count += calls
      }
    }

    // last 7 days
    if (row.date >= sevenDaysAgo) {
      const entry = last7DaysMap.get(row.date)
      if (entry && (service === 'gemini' || service === 'youtube' || service === 'supadata')) {
        entry[service] += calls
      }
    }
  }

  return NextResponse.json({
    today: todayTotals,
    thisMonth: monthTotals,
    last7Days: Array.from(last7DaysMap.values()),
  })
}
