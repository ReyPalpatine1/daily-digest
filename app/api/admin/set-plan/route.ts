import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { enforceChannelLimit, activateAllChannels, restoreDeliveryToEmail } from '@/lib/plan-sync'
import { invalidateUsersCache } from '../users/route'

export async function POST(request: Request) {
  // === 관리자 권한 확인 ===
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

  // === 입력 파싱 ===
  let body: { targetUserId?: string; plan?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { targetUserId, plan } = body
  if (!targetUserId || (plan !== 'vip' && plan !== 'pro' && plan !== 'free')) {
    // 승격: VIP 지정('vip') / Pro 지정('pro') · 강등: 해제('free')
    return NextResponse.json({ error: 'targetUserId와 plan(vip|pro|free)이 필요합니다' }, { status: 400 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // === 대상 사용자 현재 플랜 확인 ===
  const { data: target, error: targetError } = await serviceClient
    .from('profiles')
    .select('id, email, plan')
    .eq('id', targetUserId)
    .single()

  if (targetError || !target) {
    return NextResponse.json({ error: '대상 사용자를 찾을 수 없습니다' }, { status: 404 })
  }

  // 결제 Pro 사용자는 관리자가 함부로 변경 못 하게 보호.
  // 단, 관리자 본인 계정(대시보드 Free/Pro 미리보기 토글)은 예외 — 본인이 의도적으로 바꾸는 것.
  if (target.plan === 'pro' && targetUserId !== user.id) {
    return NextResponse.json(
      { error: '결제한 Pro 사용자는 VIP 지정/해제로 변경할 수 없습니다' },
      { status: 409 }
    )
  }

  // === 플랜 업데이트 ===
  // 관리자 지정 Pro는 만료 없는 Pro(plan_expires_at=null) — 결제 Pro(만료일 있음)와 구분되고
  // syncUserPlan 자동 만료강등 대상도 아님.
  // plan_changed_at: 현재 플랜으로 바뀐 시각. 세 분기 모두 기록해 통계(Pro N일째·평균)의 기준이 되게 한다.
  const changedAt = new Date().toISOString()
  const update =
    plan === 'vip'
      ? {
          plan: 'vip',
          vip_granted_by: user.email,
          vip_granted_at: changedAt,
          plan_expires_at: null,
          plan_changed_at: changedAt,
        }
      : plan === 'pro'
      ? {
          plan: 'pro',
          vip_granted_by: null,
          vip_granted_at: null,
          plan_expires_at: null,
          plan_changed_at: changedAt,
        }
      : {
          plan: 'free',
          vip_granted_by: null,
          vip_granted_at: null,
          plan_expires_at: null,
          plan_changed_at: changedAt,
        }

  const { error: updateError } = await serviceClient
    .from('profiles')
    .update(update)
    .eq('id', targetUserId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // 플랜 변경에 따른 채널 활성화 동기화
  if (plan === 'free') {
    await enforceChannelLimit(targetUserId)   // VIP 해제 → 오래된 5개만 활성
    await restoreDeliveryToEmail(targetUserId) // PRO 전용 발송 채널 → 이메일로 복구
  } else {
    await activateAllChannels(targetUserId)   // VIP 지정 → 전체 활성
  }

  // 플랜 변경 즉시 통계에 반영되도록 users 캐시 무효화
  invalidateUsersCache()

  return NextResponse.json({ success: true, targetUserId, plan, email: target.email })
}
