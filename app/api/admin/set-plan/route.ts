import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { enforceChannelLimit, activateAllChannels } from '@/lib/plan-sync'
import { invalidateUsersCache } from '../users/route'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

export async function POST(request: Request) {
  // === 관리자 권한 확인 ===
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
  if (!targetUserId || (plan !== 'vip' && plan !== 'free')) {
    // VIP 지정('vip') / VIP 해제('free')만 허용
    return NextResponse.json({ error: 'targetUserId와 plan(vip|free)이 필요합니다' }, { status: 400 })
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

  // 결제 Pro 사용자는 관리자가 함부로 변경 못 하게 보호
  if (target.plan === 'pro') {
    return NextResponse.json(
      { error: '결제한 Pro 사용자는 VIP 지정/해제로 변경할 수 없습니다' },
      { status: 409 }
    )
  }

  // === 플랜 업데이트 ===
  const update =
    plan === 'vip'
      ? {
          plan: 'vip',
          vip_granted_by: user.email,
          vip_granted_at: new Date().toISOString(),
          plan_expires_at: null,
        }
      : {
          plan: 'free',
          vip_granted_by: null,
          vip_granted_at: null,
          plan_expires_at: null,
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
  } else {
    await activateAllChannels(targetUserId)   // VIP 지정 → 전체 활성
  }

  // 플랜 변경 즉시 통계에 반영되도록 users 캐시 무효화
  invalidateUsersCache()

  return NextResponse.json({ success: true, targetUserId, plan, email: target.email })
}
