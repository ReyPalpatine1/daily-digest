import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

const DAY_MS = 86_400_000

// 두 시각 사이의 경과일(올림 아님, 최소 1) — "N일째" 계산용
function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / DAY_MS) + 1 // 가입 당일을 1일째로
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

  // === 프로필 조회 (신규 컬럼이 없을 수 있어 방어적으로) ===
  let rows: any[] = []
  const fullCols = 'id, email, name, plan, plan_expires_at, vip_granted_by, vip_granted_at, created_at, admin_note, last_active_at'
  const res = await serviceClient
    .from('profiles')
    .select(fullCols)
    .order('created_at', { ascending: false })
  if (res.error) {
    // admin_note / last_active_at / created_at 컬럼이 아직 없는 환경 폴백
    const fallback = await serviceClient
      .from('profiles')
      .select('id, email, name, plan, plan_expires_at, vip_granted_by, vip_granted_at')
    rows = fallback.data ?? []
  } else {
    rows = res.data ?? []
  }

  // === 채널/다이제스트 수 집계 (사용자별) ===
  // 사용자가 적어 실시간 집계. 많아지면 캐싱/RPC로 전환.
  const channelCount = new Map<string, number>()
  const digestCount = new Map<string, number>()

  const { data: channelRows } = await serviceClient.from('channels').select('user_id')
  for (const c of channelRows ?? []) {
    const uid = (c as any).user_id
    if (uid) channelCount.set(uid, (channelCount.get(uid) ?? 0) + 1)
  }

  const { data: digestRows } = await serviceClient.from('digests').select('user_id')
  for (const dRow of digestRows ?? []) {
    const uid = (dRow as any).user_id
    if (uid) digestCount.set(uid, (digestCount.get(uid) ?? 0) + 1)
  }

  // 이메일 발송 추적 테이블이 아직 없음 → 발송 성공률은 null (UI에서 "—")
  const emailSuccessRate: number | null = null

  const users = rows.map(p => {
    const plan = (p.plan as 'free' | 'pro' | 'vip') ?? 'free'
    const createdAt = p.created_at ?? null
    const vipGrantedAt = p.vip_granted_at ?? null

    const joinDays = daysSince(createdAt) // 가입 경과일
    // 플랜 경과일: vip는 지정일 기준, 그 외는 가입일 기준
    const planBase = plan === 'vip' && vipGrantedAt ? vipGrantedAt : createdAt
    const planDays = daysSince(planBase)

    const totalDigests = digestCount.get(p.id) ?? 0
    const avgDigestsPerDay = joinDays > 0
      ? Math.round((totalDigests / joinDays) * 10) / 10
      : 0

    return {
      id: p.id,
      email: p.email ?? '-',
      name: p.name ?? null,
      plan,
      adminNote: p.admin_note ?? null,
      createdAt,
      lastActiveAt: p.last_active_at ?? null,
      planDays,
      joinDays,
      channelCount: channelCount.get(p.id) ?? 0,
      totalDigests,
      avgDigestsPerDay,
      emailSuccessRate,
      vipGrantedBy: p.vip_granted_by ?? null,
      vipGrantedAt,
    }
  })

  const summary = {
    total: users.length,
    free: users.filter(u => u.plan === 'free').length,
    pro: users.filter(u => u.plan === 'pro').length,
    vip: users.filter(u => u.plan === 'vip').length,
  }

  // counts 는 기존 호환을 위해 동일 객체 유지
  return NextResponse.json({ users, summary, counts: summary })
}
