import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeChannelUrl } from '@/lib/channel-url'
import { resolveChannelId, canonicalChannelUrl } from '@/lib/youtube'
import { consentRequiredResponse } from '@/lib/consent'

const FREE_CHANNEL_LIMIT = 5

// 서버 측 Pro 판정 — DB(profiles)의 plan/plan_expires_at만 따른다(관리자 예외 없음, lib/supabase.ts checkIsPro와 같은 원칙)
function isProPlan(plan: string | null | undefined, planExpiresAt: string | null | undefined): boolean {
  if (plan === 'vip') return true
  if (plan === 'pro') {
    if (!planExpiresAt) return true
    return new Date(planExpiresAt) > new Date()
  }
  return false
}

export async function POST(request: Request) {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안에서 읽는다.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

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

  // 첫 로그인 동의(이용약관·만 14세 이상) 전에는 막는다.
  const consentBlock = await consentRequiredResponse(user.id)
  if (consentBlock) return consentBlock

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
    .select('url, channel_id, is_active')
    .eq('user_id', user.id)
  const existingChannels = existing ?? []

  // === Free 사용자 채널 수 제한 (활성 채널 기준) ===
  // 주소 해석(YouTube API 호출)보다 먼저 끊는다 — 어차피 추가할 수 없는 요청에 할당량을 쓰지 않는다.
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()

  const isPro = isProPlan(profile?.plan, profile?.plan_expires_at)
  const activeCount = existingChannels.filter(ch => ch.is_active !== false).length

  if (!isPro && activeCount >= FREE_CHANNEL_LIMIT) {
    return NextResponse.json(
      { error: '무료 플랜은 최대 5개까지 추가 가능합니다.', code: 'CHANNEL_LIMIT' },
      { status: 403 }
    )
  }

  // === 입력 주소 → 채널 ID 확정 (채널·@핸들·영상·쇼츠·라이브 주소) ===
  // 해석 실패면 채널을 만들지 않는다(영상 없는 채널로 남는 것 방지).
  const channelId = await resolveChannelId(url, user.id)
  if (!channelId) {
    return NextResponse.json({ error: 'invalid_channel_url' }, { status: 400 })
  }
  const canonicalUrl = canonicalChannelUrl(channelId)

  // === 중복 채널 방지 ===
  // channel_id 기준. channel_id가 아직 없는 기존 행은 정규화 url을 정식 주소와 비교한다.
  const normalizedCanonical = normalizeChannelUrl(canonicalUrl)
  if (existingChannels.some(ch =>
    ch.channel_id
      ? ch.channel_id === channelId
      : normalizeChannelUrl(ch.url) === normalizedCanonical
  )) {
    return NextResponse.json(
      { error: '이미 추가된 채널입니다.', code: 'CHANNEL_DUPLICATE' },
      { status: 409 }
    )
  }

  // === 채널 추가 (RLS 적용된 사용자 컨텍스트로 삽입) ===
  const { data: inserted, error: insertError } = await supabase
    .from('channels')
    .insert({
      user_id: user.id,
      url: canonicalUrl,
      channel_id: channelId,
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
