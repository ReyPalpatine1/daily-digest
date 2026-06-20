import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const DAY_MS = 86_400_000

// 관리자 통계는 실시간일 필요 없음 → 60초 메모리 캐시(인증 통과 후 집계 결과에만 적용)
let cache: { at: number; payload: any } | null = null
const CACHE_TTL_MS = 60_000

// set-plan 등 변경 직후 즉시 반영되도록 캐시를 비우는 훅
export function invalidateUsersCache() {
  cache = null
}

// 두 시각 사이의 경과일(올림 아님, 최소 1) — "N일째" 계산용
function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / DAY_MS) + 1 // 가입 당일을 1일째로
}

export async function GET() {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안에서 읽는다. 최상단에서 읽으면 adminEmails가 빈 배열이 되어 403이 난다.
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

  // 인증 통과 후, 신선한 캐시가 있으면 즉시 응답
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload)
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // === 프로필 조회 (신규 컬럼이 없을 수 있어 방어적으로) ===
  // 프로필 조회와 집계 RPC 3개는 서로 의존이 없어 병렬 실행.
  const fullCols = 'id, email, name, plan, plan_expires_at, vip_granted_by, vip_granted_at, created_at, admin_note, last_active_at'
  const fetchProfiles = async (): Promise<any[]> => {
    const res = await serviceClient
      .from('profiles')
      .select(fullCols)
      .order('created_at', { ascending: false })
    if (res.error) {
      // admin_note / last_active_at / created_at 컬럼이 아직 없는 환경 폴백
      const fallback = await serviceClient
        .from('profiles')
        .select('id, email, name, plan, plan_expires_at, vip_granted_by, vip_granted_at')
      return fallback.data ?? []
    }
    return res.data ?? []
  }

  const [rows, channelStats, digestStats, emailStats] = await Promise.all([
    fetchProfiles(),
    serviceClient.rpc('admin_channel_counts'),
    serviceClient.rpc('admin_digest_counts'),
    serviceClient.rpc('admin_email_stats'),
  ])

  // === 채널/다이제스트 수 집계 (사용자별) — DB 집계 RPC ===
  // rpc가 에러거나 함수가 없으면 해당 집계는 0으로 처리(페이지는 죽지 않게).
  // bigint는 문자열로 올 수 있어 Number()로 변환.
  const channelCount = new Map<string, number>()
  for (const c of (channelStats.error ? [] : channelStats.data) ?? []) {
    const uid = (c as any).user_id
    if (uid) channelCount.set(uid, Number((c as any).cnt) || 0)
  }

  const digestCount = new Map<string, number>()
  for (const dRow of (digestStats.error ? [] : digestStats.data) ?? []) {
    const uid = (dRow as any).user_id
    if (uid) digestCount.set(uid, Number((dRow as any).cnt) || 0)
  }

  // === 이메일 발송 성공률 집계 (email_logs 기준, user_id별) — DB 집계 RPC ===
  // 함수가 없거나 비어 있으면 데이터 없음 → UI에서 "—"
  const emailTotal = new Map<string, number>()
  const emailSuccess = new Map<string, number>()
  for (const row of (emailStats.error ? [] : emailStats.data) ?? []) {
    const uid = (row as any).user_id
    if (!uid) continue
    emailTotal.set(uid, Number((row as any).total) || 0)
    emailSuccess.set(uid, Number((row as any).success) || 0)
  }

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

    // 발송 성공률: 로그 있으면 % (반올림), 없으면 null
    const mailTotal = emailTotal.get(p.id) ?? 0
    const emailSuccessRate = mailTotal > 0
      ? Math.round(((emailSuccess.get(p.id) ?? 0) / mailTotal) * 100)
      : null

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
  const payload = { users, summary, counts: summary }
  cache = { at: Date.now(), payload }
  return NextResponse.json(payload)
}
