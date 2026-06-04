import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { enforceChannelLimit } from '@/lib/plan-sync'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

// 구독 취소 → Free 강등 + 채널 정리.
// ⚠️ 현재 결제는 데모 단계라 실제 결제사 연동(환불/해지 처리)은 없음.
//    실제 결제 연동 시 결제 해지 성공 후 이 로직을 호출하도록 준비해 둔 라우트.
export async function POST() {
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

  // 현재 플랜 확인 — VIP(관리자 지정)는 결제 취소 대상이 아님
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  if (profile?.plan === 'vip') {
    return NextResponse.json(
      { error: 'VIP 플랜은 구독 취소 대상이 아닙니다.' },
      { status: 409 }
    )
  }

  // Free로 강등 + 채널 정리 (기존 채널은 삭제하지 않고 비활성화만)
  await serviceClient
    .from('profiles')
    .update({ plan: 'free', plan_expires_at: null })
    .eq('id', user.id)

  await enforceChannelLimit(user.id)

  return NextResponse.json({ success: true })
}
