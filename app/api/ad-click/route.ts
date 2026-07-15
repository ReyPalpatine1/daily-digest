import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// 다이제스트 메일 광고 클릭 카운터 (인증 없음 — 메일 링크에서 직접 진입).
// 클릭을 best-effort로 기록한 뒤 항상 /pricing 으로 302 이동시킨다.
// 제휴(partner) 목적지는 제휴 링크 확보 시 확장 예정.

export async function GET(request: Request) {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 핸들러 안에서 읽는다.
  const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')

  const { searchParams } = new URL(request.url)
  const slotParam = searchParams.get('slot')
  const slot = slotParam === 'partner' ? 'partner' : 'pro_banner'

  // 메일 보안 스캐너가 링크를 사전 클릭해 집계를 오염시키므로,
  // 봇으로 보이면 기록은 하되 is_bot=true로 구분한다.
  const userAgent = request.headers.get('user-agent') ?? ''
  const isBot = /bot|crawl|spider|preview|scan|monitor|curl|python|wget/i.test(userAgent)

  // 기록은 best-effort — 실패해도 사용자 이동은 막지 않는다.
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey)
    const { error } = await serviceClient
      .from('ad_clicks')
      .insert({ slot, user_agent: userAgent, is_bot: isBot })
    if (error) console.error('[ad-click] 기록 실패:', error.message)
  } catch (e) {
    console.error('[ad-click] 기록 실패:', e)
  }

  return NextResponse.redirect(`${APP_URL}/pricing`, 302)
}
