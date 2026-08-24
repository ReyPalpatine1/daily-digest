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
  let body: { targetUserId?: string; plan?: string; fromVipTool?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { targetUserId, plan, fromVipTool } = body
  if (!targetUserId || (plan !== 'vip' && plan !== 'pro' && plan !== 'free')) {
    // 승격: VIP 지정('vip') / Pro 지정('pro') · 강등: 해제('free')
    return NextResponse.json({ error: 'targetUserId와 plan(vip|pro|free)이 필요합니다' }, { status: 400 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // === 대상 사용자 현재 플랜 확인 ===
  const { data: target, error: targetError } = await serviceClient
    .from('profiles')
    .select('id, email, plan, plan_status, plan_expires_at')
    .eq('id', targetUserId)
    .single()

  if (targetError || !target) {
    return NextResponse.json({ error: '대상 사용자를 찾을 수 없습니다' }, { status: 404 })
  }

  // VIP는 관리자가 수동으로 부여한 값이라 덮어쓰면 되돌리기 어렵다(vip_granted_by/at이 지워진다).
  // 대시보드의 Free/Pro 토글은 'pro'/'free'만 보내므로 VIP 계정에서 누르면 VIP가 날아간다 → 막는다.
  // VIP 관리 화면(/admin/users)은 VIP 지정·해제가 본래 용도이므로 fromVipTool로 의도를 명시해 통과시킨다.
  if (target.plan === 'vip' && !fromVipTool) {
    return NextResponse.json(
      { error: 'VIP 계정은 이 도구로 변경할 수 없습니다' },
      { status: 400 }
    )
  }

  // ★ 결제가 살아 있는 계정은 본인 계정이라도 막는다 (관리자 예외 없음).
  //
  // 예전에는 아래 "결제 Pro 보호"가 본인 계정만 예외로 뚫려 있었다. 그런데 이 라우트를 부르는
  // 대시보드 헤더의 Free/Pro 토글은 정확히 본인 계정만 대상으로 한다 — 가드가 열린 유일한 대상이
  // 버튼이 겨냥하는 유일한 대상이었던 셈이라, 클릭 한 번에 plan_expires_at(남은 기간)과 결제 상태
  // 일체가 경고 없이 사라졌다. billing_keys·payments는 그대로 남으므로 "돈은 냈는데 Free"가 된다.
  //
  // 판정은 plan='pro'라는 부정확한 대용물 대신 결제 상태 자체로 한다:
  //   · plan_status='active'     : 자동 갱신 중(갱신 대기·실패 중 포함)
  //   · plan_expires_at이 미래   : 이미 결제된 이용 기간이 남아 있음(1개월권·체험 포함)
  // 관리자 지정 Pro는 plan_status='none' + plan_expires_at=null이라 여기 걸리지 않는다
  // → 개발용 Free/Pro 토글은 종전대로 동작한다.
  const hasPaidPeriod =
    !!target.plan_expires_at && new Date(target.plan_expires_at) > new Date()
  if (target.plan_status === 'active' || hasPaidPeriod) {
    return NextResponse.json(
      {
        error:
          '결제 중인 계정은 이 도구로 변경할 수 없습니다. 먼저 자동 갱신을 해지하거나 이용 기간이 끝난 뒤에 사용하세요',
      },
      { status: 409 }
    )
  }

  // 결제 Pro 사용자는 관리자가 함부로 변경 못 하게 보호(위 결제 상태 가드를 통과한 계정에 대한 2차 방어).
  // 본인 계정은 개발용 토글의 대상이므로 여기서는 통과시킨다 — 결제 보호는 위에서 이미 끝났다.
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
          // 결제로 올린 Pro가 아니므로 결제 상태를 붙이지 않는다.
          // 'active'면 갱신 대상이 되고 'onetime'이면 만료 안내가 나가는데, 둘 다 사실이 아니다.
          plan_status: 'none',
        }
      : {
          plan: 'free',
          vip_granted_by: null,
          vip_granted_at: null,
          plan_expires_at: null,
          plan_changed_at: changedAt,
          // 결제 흔적을 함께 정리한다. 빠뜨리면 plan='free'인데 plan_status='active'인
          // 계정이 남아 갱신 로직이 어떻게 다룰지 애매해진다.
          plan_status: 'none',
          cancel_at_period_end: false,
          renew_fail_count: 0,
          renew_failed_at: null,
          renew_notified_at: null,
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
