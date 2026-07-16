import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { partnerLink } from '@/lib/ads'

// 광고 클릭 카운터 (인증 없음 — 메일 링크·웹 광고 카드에서 직접 진입).
// 클릭을 best-effort로 기록한 뒤 목적지로 302 이동시킨다:
//   slot=partner → 제휴 링크(lib/ads.ts), 그 외 → /pricing

export async function GET(request: Request) {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 핸들러 안에서 읽는다.
  const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')

  const { searchParams } = new URL(request.url)
  const slotParam = searchParams.get('slot')
  const slot = slotParam === 'partner' ? 'partner' : 'pro_banner'

  // 클릭 출처 (email/dashboard/history) — 그 외 값·누락은 null로 기록.
  const srcParam = searchParams.get('src')
  const src = srcParam === 'email' || srcParam === 'dashboard' || srcParam === 'history' ? srcParam : null

  // dest=banner → 쿠팡 배너 전용 목적지, 그 외 → 기존 동작.
  const isBanner = searchParams.get('dest') === 'banner'

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
      .insert({ slot, source: src, user_agent: userAgent, is_bot: isBot })
    if (error) console.error('[ad-click] 기록 실패:', error.message)
  } catch (e) {
    console.error('[ad-click] 기록 실패:', e)
  }

  const destination = isBanner
    ? partnerLink('banner')
    : slot === 'partner' ? partnerLink() : `${APP_URL}/pricing`
  return NextResponse.redirect(destination, 302)
}
