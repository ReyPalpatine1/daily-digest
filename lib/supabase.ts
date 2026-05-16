import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export type Profile = {
  id: string
  name: string
  email: string
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