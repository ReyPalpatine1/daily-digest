import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { checkTrialEligibility } from '@/lib/trial-guard'

// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
// env는 이 함수를 호출하는 핸들러 안에서 읽어 넘긴다.
async function getAuthedUser(supabaseUrl: string, supabaseAnonKey: string) {
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
  const { data: { user }, error } = await authClient.auth.getUser()
  return error || !user ? null : user
}

// 체험 가능 여부 조회 — trial_used + trial_history 대조(조회만, DB 변경 없음).
// 탈퇴→재가입 사용자(trial_used=false지만 이력 있음)에게 체험 버튼을 잘못 보여주지 않기 위해 사용.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser(supabaseUrl, supabaseAnonKey)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const { eligible } = await checkTrialEligibility(serviceClient, user)
  return NextResponse.json({ eligible })
}

// 7일 무료 체험 시작 — 카드 없이 서버에서만 부여(재체험 방지는 trial_used + trial_history로 서버 검사).
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser(supabaseUrl, supabaseAnonKey)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // trial_used 검사 + 재가입 재악용 방지(탈퇴해도 남는 trial_history 이력 대조).
  const { eligible, profile, emailHash, platformId } = await checkTrialEligibility(
    serviceClient,
    user
  )
  if (!eligible) {
    return NextResponse.json({ error: 'trial_already_used' }, { status: 409 })
  }

  if (profile?.plan === 'vip') {
    return NextResponse.json({ error: 'vip' }, { status: 400 })
  }

  const isCurrentlyPro =
    profile?.plan === 'pro' &&
    (!profile.plan_expires_at || new Date(profile.plan_expires_at) > new Date())
  if (isCurrentlyPro) {
    return NextResponse.json({ error: 'already_pro' }, { status: 400 })
  }

  const planExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error: updateError } = await serviceClient
    .from('profiles')
    .update({
      plan: 'pro',
      plan_status: 'trialing',
      trial_used: true,
      plan_expires_at: planExpiresAt,
      plan_changed_at: new Date().toISOString(), // 체험 시작 = Pro 전환 시각(통계 기준)
    })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // 체험 사용 이력 기록(탈퇴 후에도 보존되어 재체험 차단에 사용).
  // insert 실패는 로깅만 — 체험 부여 자체는 이미 성공했으므로 성공 처리.
  const { error: historyInsertError } = await serviceClient
    .from('trial_history')
    .insert({ email_hash: emailHash, platform_id: platformId })
  if (historyInsertError) {
    console.error('[subscription/trial] trial_history 기록 실패:', historyInsertError.message)
  }

  return NextResponse.json({ ok: true, plan_expires_at: planExpiresAt })
}
