import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

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

  return NextResponse.json({ ok: true, plan_expires_at: planExpiresAt })
}
