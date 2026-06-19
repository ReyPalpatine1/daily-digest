// 플랜 강등/승격에 따른 채널 활성화 동기화 (서버 전용)
// ⚠️ SUPABASE_SERVICE_KEY 를 사용하므로 서버(라우트 핸들러)에서만 import 할 것.
//    클라이언트 컴포넌트에서 import 금지.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { nowUtc } from './time'

// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 처리 시점에 채워짐)
// service client를 최상단이 아니라 첫 사용 시점에 lazy 생성한다.
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return _supabase
}

// 기존 `supabase.from(...)` 사용처를 그대로 두기 위해 Proxy로 인터페이스 유지.
const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export const FREE_ACTIVE_LIMIT = 5

// Free로 강등 시: 오래된 5개만 활성, 나머지 비활성 (기존 채널은 삭제하지 않음)
export async function enforceChannelLimit(userId: string): Promise<void> {
  const { data: channels } = await supabase
    .from('channels')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true }) // 오래된 순

  if (!channels) return

  if (channels.length > FREE_ACTIVE_LIMIT) {
    const keepActive = channels.slice(0, FREE_ACTIVE_LIMIT).map(c => c.id) // 앞 5개
    const deactivate = channels.slice(FREE_ACTIVE_LIMIT).map(c => c.id)    // 나머지

    await supabase.from('channels').update({ is_active: true }).in('id', keepActive)
    await supabase.from('channels').update({ is_active: false }).in('id', deactivate)
  } else {
    // 5개 이하면 전부 활성
    await supabase.from('channels').update({ is_active: true }).eq('user_id', userId)
  }
}

// Pro/VIP 승격 시: 전체 활성화
export async function activateAllChannels(userId: string): Promise<void> {
  await supabase.from('channels').update({ is_active: true }).eq('user_id', userId)
}

// 만료 체크 + 동기화 (cron/digest에서 호출).
// Pro인데 plan_expires_at 경과 시 free로 강등하고 채널 정리.
export async function syncUserPlan(userId: string): Promise<'free' | 'pro' | 'vip'> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .single()

  if (!profile) return 'free'

  if (profile.plan === 'pro' && profile.plan_expires_at) {
    const isExpired = new Date(profile.plan_expires_at) < nowUtc()
    if (isExpired) {
      await supabase
        .from('profiles')
        .update({ plan: 'free', plan_expires_at: null })
        .eq('id', userId)
      await enforceChannelLimit(userId)
      console.log(`📉 Plan 만료 강등: ${userId}`)
      return 'free'
    }
  }

  return (profile.plan as 'free' | 'pro' | 'vip') ?? 'free'
}
