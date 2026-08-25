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
  // 미리보기(가입 직후 1회) 사용 시각 / 첫 정기 발송 시각. 둘 다 없을 때만 미리보기 노출.
  preview_used_at: string | null
  first_digest_at: string | null
  // 자동 갱신 해지 예약. true면 만료일에 재결제하지 않고 그대로 종료된다(남은 기간은 이용 가능).
  cancel_at_period_end: boolean
  // 정기 갱신 실패 상태(재시도·강등 판정용). 결제가 성공하면 전부 초기화된다.
  renew_failed_at: string | null
  renew_fail_count: number
  renew_notified_at: string | null
  // 3회 실패 강등 후 종료 안내를 보낸 시각. renew_notified_at(1차 실패 안내)과 용도가 다르다
  // — 한 컬럼을 같이 쓰던 시절엔 1차 안내를 받은 계정에 종료 안내가 영영 나가지 않았다.
  sub_ended_notified_at: string | null
}

// 사용자의 실제 Pro 여부 판정 (VIP = 무기한 Pro, Pro = 만료일 확인)
//
// ★ 화면 판정의 유일한 근거는 DB(profiles)다. 관리자 예외도, localStorage 미리보기 플래그도 두지 않는다.
//   과거엔 isAdmin=true면 무조건 Pro로 보는 단축이 있었는데, 그 탓에 관리자는 헤더가 항상 PRO라
//   자기 실제 플랜을 화면에서 확인할 수 없었고 페이지마다 표시가 어긋났다.
//   (서버의 ADMIN_EMAILS 단축은 "표시"가 아니라 "실행 권한"이라 그대로 둔다 — api/channels·digest·preview·breaking)
export function checkIsPro(profile: Profile | null): boolean {
  if (!profile) return false

  // VIP는 무기한 Pro
  if (profile.plan === 'vip') return true

  // Pro 결제: 만료일 확인
  if (profile.plan === 'pro') {
    if (!profile.plan_expires_at) return true // 만료일 없으면 유효
    if (new Date(profile.plan_expires_at) > new Date()) return true // 만료 안 됐으면 유효

    // ★ 갱신 재시도 대기(dunning) — 만료됐어도 서버는 아직 Pro로 대우한다.
    //   runRenewals가 24시간 간격으로 3회까지 재결제를 시도하는 동안(최대 3일) 서버는
    //   이 계정을 강등하지 않는데(lib/plan-sync.ts의 awaitingRenewal), 화면이 만료일만 보면
    //   그 사이 뱃지가 FREE로 떨어져 사용자는 "갑자기 무료가 됐다"고 인식한다.
    //   3회 실패로 실제 강등되면 plan='free'가 되므로 이 분기 자체가 사라진다.
    //   ※ 조건은 lib/plan-sync.ts의 awaitingRenewal과 반드시 같아야 한다.
    //     갈리는 순간 화면과 서버 판정이 다시 어긋난다.
    return profile.plan_status === 'active' && profile.cancel_at_period_end === false
  }

  return false // free
}

export type PlanView = 'free' | 'trialing' | 'pro' | 'trial_expired'

export function getPlanView(profile: Profile | null): PlanView {
  if (!profile) return 'free'
  if (profile.plan === 'vip') return 'pro'
  if (checkIsPro(profile)) {
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