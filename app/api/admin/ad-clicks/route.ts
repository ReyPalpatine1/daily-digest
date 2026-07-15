import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { startOfDayUtc } from '@/lib/time'

// 관리자 광고 클릭 집계 — slot별 {오늘(KST 자정 이후), 누적} + 봇 클릭 수.
// 오늘/누적은 is_bot=false만 집계(메일 보안 스캐너의 사전 클릭 제외).

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

  const todayStartIso = startOfDayUtc('Asia/Seoul').toISOString()
  const countQuery = () => serviceClient.from('ad_clicks').select('*', { count: 'exact', head: true })

  const [proToday, proTotal, partnerToday, partnerTotal, bots] = await Promise.all([
    countQuery().eq('slot', 'pro_banner').eq('is_bot', false).gte('clicked_at', todayStartIso),
    countQuery().eq('slot', 'pro_banner').eq('is_bot', false),
    countQuery().eq('slot', 'partner').eq('is_bot', false).gte('clicked_at', todayStartIso),
    countQuery().eq('slot', 'partner').eq('is_bot', false),
    countQuery().eq('is_bot', true),
  ])

  const failed = [proToday, proTotal, partnerToday, partnerTotal, bots].find(r => r.error)
  if (failed?.error) {
    console.error('[admin/ad-clicks] 집계 실패:', failed.error.message)
    return NextResponse.json({ error: '집계 실패' }, { status: 500 })
  }

  return NextResponse.json({
    proBanner: { today: proToday.count ?? 0, total: proTotal.count ?? 0 },
    partner: { today: partnerToday.count ?? 0, total: partnerTotal.count ?? 0 },
    bots: bots.count ?? 0,
  })
}
