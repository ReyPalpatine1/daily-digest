// 메일 광고 포함 판정 — 다이제스트·미리보기·관리자 단건 발송이 모두 이 파일의 함수 하나
// (getEmailAdsForUser)를 거친다. 판정: 무료 회원(Pro·VIP 아님) AND profiles.ad_consent = true.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버 전용. env는 모두 함수 안에서 읽는다(Cloudflare 호환).
import { createClient } from '@supabase/supabase-js'
import { checkIsPro, type Profile } from './supabase'
import { buildUnsubscribeToken, getUnsubscribeSecret } from './unsubscribe-link'

export type AdsProfileFields = Pick<Profile, 'plan' | 'plan_expires_at' | 'plan_status' | 'cancel_at_period_end'> & {
  ad_consent: boolean | null
}

// 순수 판정 — 플랜 판정은 checkIsPro(lib/supabase.ts)를 그대로 쓴다.
export function shouldIncludeEmailAds(profile: AdsProfileFields | null): boolean {
  if (!profile || profile.ad_consent !== true) return false
  return !checkIsPro(profile as unknown as Profile)
}

export type UnsubscribeLinks = {
  // 본문 [수신 거부] 링크 — 열리면 클라이언트가 POST /api/unsubscribe를 자동 호출한다.
  unsubscribeUrl: string
  // List-Unsubscribe 헤더용 — 원클릭(RFC 8058) POST를 받는 API 주소.
  oneClickUrl: string
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')
}

// 광고 수신거부 서명 링크. UNSUBSCRIBE_SECRET이 없으면 null(호출부는 광고 메일을 보내지 않는다).
export function adsUnsubscribeLinks(userId: string): UnsubscribeLinks | null {
  const secret = getUnsubscribeSecret()
  if (!secret) return null
  const token = encodeURIComponent(buildUnsubscribeToken(userId, 'ads', secret))
  const base = appUrl()
  return {
    unsubscribeUrl: `${base}/unsubscribe?t=${token}`,
    oneClickUrl: `${base}/api/unsubscribe?t=${token}`,
  }
}

// 이 회원에게 보낼 메일에 광고를 넣을지 + 넣는다면 수신거부 링크. 넣지 않으면 null.
// userId가 없으면(관리자 단건 발송 등) 광고 없음. 조회 실패도 광고 없음(안전 쪽).
export async function getEmailAdsForUser(userId: string | null): Promise<UnsubscribeLinks | null> {
  if (!userId) return null
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
  const { data, error } = await client
    .from('profiles')
    .select('plan, plan_expires_at, plan_status, cancel_at_period_end, ad_consent')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[email-ads] 프로필 조회 실패 — 광고 제외:', userId, error.message)
    return null
  }
  if (!shouldIncludeEmailAds(data as AdsProfileFields | null)) return null
  const links = adsUnsubscribeLinks(userId)
  if (!links) {
    // 수신거부 링크 없이 광고 메일을 보내면 위법 — 광고를 빼고 보낸다.
    console.error('[email-ads] UNSUBSCRIBE_SECRET 미설정 — 수신거부 링크를 만들 수 없어 광고 제외:', userId)
    return null
  }
  return links
}
