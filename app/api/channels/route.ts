import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeChannelUrl } from '@/lib/channel-url'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const FREE_CHANNEL_LIMIT = 5

// 서버 측 Pro 판정 (lib/supabase.ts의 checkIsPro와 동일 로직)
function isProPlan(plan: string | null | undefined, planExpiresAt: string | null | undefined, email: string | null | undefined): boolean {
  if (email && adminEmails.includes(email.toLowerCase())) return true
  if (plan === 'vip') return true
  if (plan === 'pro') {
    if (!planExpiresAt) return true
    return new Date(planExpiresAt) > new Date()
  }
  return false
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // === 입력 파싱 ===
  let body: { url?: string; alias?: string; emoji?: string; category_id?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const url = (body.url ?? '').trim()
  const alias = (body.alias ?? '').trim()
  if (!url || !alias) {
    return NextResponse.json({ error: 'url과 alias가 필요합니다' }, { status: 400 })
  }

  // === 기존 채널 조회 (중복 체크 + 개수 제한에 함께 사용) ===
  const { data: existing } = await supabase
    .from('channels')
    .select('url, is_active')
    .eq('user_id', user.id)
  const existingChannels = existing ?? []

  // === 중복 채널 방지 (정규화 URL 기준) ===
  const normalizedNew = normalizeChannelUrl(url)
  if (existingChannels.some(ch => normalizeChannelUrl(ch.url) === normalizedNew)) {
    return NextResponse.json(
      { error: '이미 추가된 채널입니다.', code: 'CHANNEL_DUPLICATE' },
      { status: 409 }
    )
  }

  // === Free 사용자 채널 수 제한 (활성 채널 기준) ===
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()

  const isPro = isProPlan(profile?.plan, profile?.plan_expires_at, user.email)
  const activeCount = existingChannels.filter(ch => ch.is_active !== false).length

  if (!isPro && activeCount >= FREE_CHANNEL_LIMIT) {
    return NextResponse.json(
      { error: '무료 플랜은 최대 5개까지 추가 가능합니다.', code: 'CHANNEL_LIMIT' },
      { status: 403 }
    )
  }

  // === 채널 추가 (RLS 적용된 사용자 컨텍스트로 삽입) ===
  const { data: inserted, error: insertError } = await supabase
    .from('channels')
    .insert({
      user_id: user.id,
      url,
      alias,
      emoji: body.emoji ?? '📺',
      category_id: body.category_id || null,
      is_active: true,
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, channel: inserted })
}
