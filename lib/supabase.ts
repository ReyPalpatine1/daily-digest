import { createBrowserClient } from '@supabase/ssr'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워진다. 모듈 최상단에서 createClient를 호출하면 키가 undefined가 되어
// "supabaseKey is required"로 터지므로, 첫 사용 시점에 1회 lazy 생성한다.
// (Vercel은 로드 시점에도 채워지므로 동작 동일)
function makeClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
type BrowserClient = ReturnType<typeof makeClient>

let _supabase: BrowserClient | null = null
function getSupabase(): BrowserClient {
  if (!_supabase) _supabase = makeClient()
  return _supabase
}

// 기존 `import { supabase }` 사용처(8곳)를 깨지 않도록 Proxy로 동일한 인터페이스 유지.
// 실제 클라이언트는 프로퍼티 첫 접근(=함수 호출 시점)에 생성된다.
export const supabase: BrowserClient = new Proxy({} as BrowserClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export type Profile = {
  id: string
  name: string
  email: string
  plan: 'free' | 'pro' | 'vip'
  plan_expires_at: string | null
  vip_granted_by: string | null
  vip_granted_at: string | null
  plan_status: 'none' | 'trialing' | 'active' | 'canceled' | 'onetime'
  trial_used: boolean
}

// 사용자의 실제 Pro 여부 판정 (VIP = 무기한 Pro, Pro = 만료일 확인)
export function checkIsPro(profile: Profile | null, isAdmin: boolean): boolean {
  if (isAdmin) return true // 관리자는 항상 Pro
  if (!profile) return false

  // VIP는 무기한 Pro
  if (profile.plan === 'vip') return true

  // Pro 결제: 만료일 확인
  if (profile.plan === 'pro') {
    if (!profile.plan_expires_at) return true // 만료일 없으면 유효
    return new Date(profile.plan_expires_at) > new Date() // 만료 안 됐으면 유효
  }

  return false // free
}

export type PlanView = 'free' | 'trialing' | 'pro' | 'trial_expired'

export function getPlanView(profile: Profile | null, isAdmin: boolean): PlanView {
  if (!profile) return 'free'
  if (isAdmin || profile.plan === 'vip') return 'pro'
  if (checkIsPro(profile, isAdmin)) {
    return profile.plan_status === 'trialing' ? 'trialing' : 'pro'
  }
  return profile.trial_used ? 'trial_expired' : 'free'
}

export type Category = {
  id: string
  user_id: string
  name: string
  color: string
}

export type Channel = {
  id: string
  user_id: string
  category_id: string | null
  alias: string
  emoji: string
  url: string
  channel_id: string | null
  is_active?: boolean
}

export type Settings = {
  id: string
  user_id: string
  send_time: string
  email: string
  breaking_keywords: string[]
  breaking_alert: boolean
  active: boolean
  locale: 'ko' | 'en' | 'zh' | 'ja'
  help_seen?: boolean
  notify_when_empty?: boolean
  delivery_method?: 'email' | 'telegram' | 'whatsapp' | 'line' | 'kakao' | null
  telegram_chat_id?: string | null
  whatsapp_number?: string | null
  line_user_id?: string | null
  kakao_user_id?: string | null
}

export type Digest = {
  id: string
  user_id: string
  channel_alias: string
  channel_emoji: string
  category_name: string
  video_id: string
  video_title: string
  video_url: string
  published_at: string
  summary: string
  key_points: string[]
  timeline: { time: string; content: string }[]
  is_breaking: boolean
  is_read: boolean
  created_at: string
  summary_basis?: string | null // 요약 근거 라벨 (자막/설명 기반 등, 한국어 원문)
  fail_reason?: string | null // no_source | temporary | pending | live | pro_only — 요약 성공 시 null
  fail_detail?: string | null // 관리자 디버그용 세부 사유
}