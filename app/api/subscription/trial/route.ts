import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { hashEmail, getPlatformId } from '@/lib/trial-guard'

// 7일 무료 체험 시작 — 카드 없이 서버에서만 부여(재체험 방지는 trial_used로 서버 검사).
export async function POST() {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안에서 읽는다.
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
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan, plan_status, trial_used, plan_expires_at')
    .eq('id', user.id)
    .single()

  if (profile?.trial_used) {
    return NextResponse.json({ error: 'trial_already_used' }, { status: 409 })
  }

  // 재가입 재악용 방지 — 탈퇴해도 남는 trial_history 이력 대조.
  // profiles가 신규 생성되어 trial_used=false여도 과거 체험 이력이 있으면 차단.
  const emailHash = user.email ? await hashEmail(user.email) : null
  const platformId = getPlatformId(user)

  const orConditions: string[] = []
  if (emailHash) orConditions.push(`email_hash.eq.${emailHash}`)
  if (platformId) orConditions.push(`platform_id.eq.${platformId}`)

  if (orConditions.length > 0) {
    const { data: history, error: historyError } = await serviceClient
      .from('trial_history')
      .select('id')
      .or(orConditions.join(','))
      .limit(1)
    if (historyError) {
      console.error('[subscription/trial] trial_history 조회 실패:', historyError.message)
    }
    if (history && history.length > 0) {
      return NextResponse.json({ error: 'trial_already_used' }, { status: 409 })
    }
  }
  // 둘 다 null이면 이력 대조는 건너뛰고 trial_used만 신뢰.

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
