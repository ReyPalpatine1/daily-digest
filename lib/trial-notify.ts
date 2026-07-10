// 7일 무료 체험 종료 알림 (서버 전용)
// ⚠️ SUPABASE_SERVICE_KEY 를 사용하므로 서버(라우트 핸들러)에서만 import 할 것.
//    클라이언트 컴포넌트에서 import 금지.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { nowUtc, dateKey } from '@/lib/time'
import { syncUserPlan } from '@/lib/plan-sync'
import { sendTrialEndingEmail, sendTrialEndedEmail } from '@/lib/mailer'

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

const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

const DAY_MS = 24 * 60 * 60 * 1000

// 발송 로케일. settings 조회가 실패해도 발송을 막지 않는다.
async function resolveLocale(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('settings')
      .select('locale')
      .eq('user_id', userId)
      .single()
    return data?.locale ?? 'ko'
  } catch {
    return 'ko'
  }
}

// 체험 종료 전날 1통(예고), 종료 당일 1통(무료 플랜 전환 안내).
// trial_ending_notified_at / trial_ended_notified_at 플래그로 계정당 1회만 발송되므로
// 15분마다 도는 cron에서 반복 호출해도 안전하다.
export async function runTrialNotifications(): Promise<void> {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, plan_expires_at, trial_ending_notified_at, trial_ended_notified_at')
      .eq('plan_status', 'trialing')
      .not('plan_expires_at', 'is', null)

    if (error) {
      console.error('[trial-notify] profiles 조회 실패:', error)
      return
    }
    if (!profiles || profiles.length === 0) return

    const now = nowUtc()

    for (const p of profiles) {
      try {
        if (!p.email) continue

        const expires = new Date(p.plan_expires_at)
        const locale = await resolveLocale(p.id)

        // (가) 종료 당일 — 이미 만료
        if (expires <= now && !p.trial_ended_notified_at) {
          await syncUserPlan(p.id) // free 강등 + 채널/발송 정리
          await sendTrialEndedEmail(p.email, locale)
          await supabase
            .from('profiles')
            .update({ trial_ended_notified_at: now.toISOString() })
            .eq('id', p.id)
          console.log(`📩 [trial-notify] 종료 안내 발송: ${p.id}`)
          continue
        }

        // (나) 종료 전날 — 24시간 이내 만료 예정
        if (
          expires > now &&
          expires.getTime() - now.getTime() <= DAY_MS &&
          !p.trial_ending_notified_at
        ) {
          const endDate = dateKey(expires) // KST 'YYYY-MM-DD'
          await sendTrialEndingEmail(p.email, endDate, locale)
          await supabase
            .from('profiles')
            .update({ trial_ending_notified_at: now.toISOString() })
            .eq('id', p.id)
          console.log(`⏳ [trial-notify] 종료 예고 발송: ${p.id}`)
        }
      } catch (e) {
        // 한 명의 실패가 나머지 유저를 막지 않게 한다.
        console.error(`[trial-notify] 유저 처리 실패 (${p.id}):`, e)
      }
    }
  } catch (e) {
    console.error('[trial-notify] 실행 실패:', e)
  }
}
