import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export type Profile = {
  id: string
  name: string
  email: string
  plan: 'free' | 'pro' | 'vip'
  plan_expires_at: string | null
  vip_granted_by: string | null
  vip_granted_at: string | null
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
  locale: 'ko' | 'en'
  notify_when_empty?: boolean
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
}