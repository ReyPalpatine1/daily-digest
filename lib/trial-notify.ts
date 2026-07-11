// 7일 무료 체험(trialing) + 1개월권(onetime, 일회성 결제) 종료 알림 (서버 전용)
// ⚠️ SUPABASE_SERVICE_KEY 를 사용하므로 서버(라우트 핸들러)에서만 import 할 것.
//    클라이언트 컴포넌트에서 import 금지.
// [PG 연동 시 필수] 결제(자동갱신/1개월권) 부여 시점에 trial_ending_notified_at /
//   trial_ended_notified_at / trial_ending_popup_seen_at / trial_ended_popup_seen_at
//   4개를 null로 리셋할 것 — 이용 사이클마다 알림이 재활성화되는 구조.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { nowUtc, dateKey } from '@/lib/time'
import { syncUserPlan } from '@/lib/plan-sync'
import {
  sendTrialEndingEmail,
  sendTrialEndedEmail,
  sendPassEndingEmail,
  sendPassEndedEmail,
} from '@/lib/mailer'
import { sendTelegramMessage } from '@/lib/telegram'
import { et, type EmailLocale } from '@/lib/i18n/email-translations'

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

// 발송 로케일·수신 주소·텔레그램 보강용 채널 정보. settings 조회가 실패해도 발송을 막지 않는다.
async function resolveSettings(
  userId: string
): Promise<{
  locale: string | null
  email: string | null
  delivery_method: string | null
  telegram_chat_id: string | null
} | null> {
  try {
    const { data } = await supabase
      .from('settings')
      .select('locale, email, delivery_method, telegram_chat_id')
      .eq('user_id', userId)
      .single()
    return data
  } catch {
    return null
  }
}

// 종료 전날 1통(예고), 종료 당일 1통(무료 플랜 전환 안내).
// trialing(체험)과 onetime(1개월권)은 발송 함수(문구)만 다르고 판정·플래그 구조는 동일.
// trial_ending_notified_at / trial_ended_notified_at 플래그로 계정당 1회만 발송되므로
// 15분마다 도는 cron에서 반복 호출해도 안전하다.
export async function runTrialNotifications(): Promise<void> {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, plan_status, plan_expires_at, trial_ending_notified_at, trial_ended_notified_at')
      .in('plan_status', ['trialing', 'onetime'])
      .not('plan_expires_at', 'is', null)

    if (error) {
      console.error('[trial-notify] profiles 조회 실패:', error)
      return
    }
    if (!profiles || profiles.length === 0) return

    const now = nowUtc()

    for (const p of profiles) {
      try {
        const expires = new Date(p.plan_expires_at)
        const settingsRow = await resolveSettings(p.id)
        const locale = settingsRow?.locale ?? 'ko'
        // 다이제스트와 동일하게 settings.email 우선, 없으면 profiles.email 폴백
        const to = settingsRow?.email || p.email
        if (!to) {
          console.warn(`[trial-notify] 수신 주소 없음 skip user=${p.id}`)
          continue
        }
        // 1개월권이면 이용권 문구 메일로, 체험이면 기존 체험 문구 메일로 발송(분기는 발송 함수뿐).
        const isOnetime = p.plan_status === 'onetime'

        // (가) 종료 당일 — 이미 만료
        if (expires <= now && !p.trial_ended_notified_at) {
          await syncUserPlan(p.id) // free 강등 + 채널/발송 정리
          // 발송이 예외 없이 끝난 경우에만 아래(로그·플래그)가 실행된다.
          // 실패 시 바깥 catch로 빠져 플래그가 안 남고, 다음 run에서 재시도된다.
          await (isOnetime ? sendPassEndedEmail(to, locale) : sendTrialEndedEmail(to, locale))
          console.log(`[trial-notify] 종료 안내 발송 완료: ${p.id}`)
          const { error: flagError } = await supabase
            .from('profiles')
            .update({ trial_ended_notified_at: now.toISOString() })
            .eq('id', p.id)
          if (flagError) {
            // 발송은 됐으므로 다음 run에서 중복 발송될 수 있음
            console.error(`[trial-notify] 플래그 기록 실패(중복 발송 가능) user=${p.id}:`, flagError)
          }
          continue
        }

        // (나) 종료 전날 — 24시간 이내 만료 예정
        if (
          expires > now &&
          expires.getTime() - now.getTime() <= DAY_MS &&
          !p.trial_ending_notified_at
        ) {
          const endDate = dateKey(expires) // KST 'YYYY-MM-DD'
          // (가)와 동일 — 발송 성공 후에만 로그·플래그 기록, 실패 시 다음 run에서 재시도.
          await (isOnetime ? sendPassEndingEmail(to, endDate, locale) : sendTrialEndingEmail(to, endDate, locale))
          console.log(`[trial-notify] 종료 예고 발송 완료: ${p.id}`)
          // 텔레그램 보강(선택자 한정, best-effort — 실패해도 플래그·흐름에 영향 없음).
          // 당일 알림은 이메일만 유지(만료 시 텔레그램 채널이 닫히므로) — 전날에만 추가.
          try {
            const chatId = settingsRow?.telegram_chat_id
            // delivery.ts effectiveMethod(m, isPro)와 동일 기준. 전날 대상자(trialing/onetime)는
            // Pro 유효 상태(isPro=true)라 effectiveMethod === 'telegram' ⇔ delivery_method === 'telegram'.
            const wantsTg = settingsRow?.delivery_method === 'telegram'
            if (wantsTg && chatId) {
              const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://dailyvideodigest.com').replace(/\/$/, '')
              const tgLocale: EmailLocale =
                locale === 'en' || locale === 'zh' || locale === 'ja' ? locale : 'ko'
              const tgText = et(tgLocale, isOnetime ? 'passEnding.tg' : 'trialEnding.tg', {
                date: endDate,
                link: `${appUrl}/subscribe?mode=pay`,
              })
              await sendTelegramMessage(chatId, tgText)
            }
          } catch (e) {
            console.error(`[trial-notify] 전날 텔레그램 보강 실패(무시) user=${p.id}:`, e)
          }
          const { error: flagError } = await supabase
            .from('profiles')
            .update({ trial_ending_notified_at: now.toISOString() })
            .eq('id', p.id)
          if (flagError) {
            // 발송은 됐으므로 다음 run에서 중복 발송될 수 있음
            console.error(`[trial-notify] 플래그 기록 실패(중복 발송 가능) user=${p.id}:`, flagError)
          }
        }
      } catch (e) {
        // 한 명의 실패가 나머지 유저를 막지 않게 한다. 플래그가 안 남았으므로 다음 run에서 재시도된다.
        console.error(`[trial-notify] 발송 실패 user=${p.id}:`, e)
      }
    }
  } catch (e) {
    console.error('[trial-notify] 실행 실패:', e)
  }
}
