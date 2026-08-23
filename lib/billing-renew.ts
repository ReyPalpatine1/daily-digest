// 정기 갱신 + 결제 실패 대응(dunning) — 서버 전용, cron에서 15분마다 호출된다.
// ⚠️ SUPABASE_SERVICE_KEY 를 사용하므로 서버(라우트 핸들러)에서만 import 할 것.
//
// 왜 필요한가
//   runTrialNotifications는 trialing/onetime만 본다. 즉 자동 갱신(active) 사용자는
//   만료돼도 아무 일도 일어나지 않는 구멍이 있었다. 이 함수가 그 구멍을 메운다.
//
// 15분마다 도는 cron에서 중복 결제가 나지 않도록 두 겹으로 막는다.
//   1) 성공하면 plan_expires_at이 30일 뒤로 밀려 대상 쿼리에서 빠진다.
//   2) 실패하면 대상에 남으므로, renew_failed_at으로 "마지막 시도 후 24시간" 재시도 간격을 둔다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { nowUtc } from './time'
import { chargeWithBillingKey } from './billing-charge'
import { syncUserPlan } from './plan-sync'
import { sendRenewFailedEmail, sendSubEndedEmail } from './mailer'

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

const HOUR_MS = 60 * 60 * 1000

// 재시도 간격 — 하루 1회.
const RETRY_INTERVAL_MS = 24 * HOUR_MS
// 이 횟수만큼 실패하면 무료로 강등한다.
const MAX_FAIL_COUNT = 3

// 발송 로케일·수신 주소. 다이제스트와 같은 규칙으로 settings.email을 우선한다.
async function resolveRecipient(
  userId: string,
  fallbackEmail: string | null
): Promise<{ to: string | null; locale: string }> {
  try {
    const { data } = await supabase
      .from('settings')
      .select('locale, email')
      .eq('user_id', userId)
      .maybeSingle()
    return { to: data?.email || fallbackEmail, locale: data?.locale ?? 'ko' }
  } catch {
    return { to: fallbackEmail, locale: 'ko' }
  }
}

type RenewTarget = {
  id: string
  email: string | null
  plan_expires_at: string
  renew_fail_count: number | null
  renew_failed_at: string | null
  renew_notified_at: string | null
}

// 만료된 자동 갱신 사용자를 재결제하고, 실패하면 재시도·안내·강등까지 처리한다.
export async function runRenewals(): Promise<void> {
  try {
    const now = nowUtc()

    const { data: targets, error } = await supabase
      .from('profiles')
      .select('id, email, plan_expires_at, renew_fail_count, renew_failed_at, renew_notified_at')
      .eq('plan_status', 'active')
      .eq('cancel_at_period_end', false) // 해지 예약자는 만료일에 그대로 종료된다
      .not('plan_expires_at', 'is', null)
      .lte('plan_expires_at', now.toISOString())

    if (error) {
      console.error('[billing-renew] 대상 조회 실패:', error)
    } else {
      for (const target of (targets ?? []) as RenewTarget[]) {
        try {
          await renewOne(target, now)
        } catch (e) {
          // 한 명의 실패가 나머지를 막지 않게 한다.
          console.error(`[billing-renew] 처리 실패 user=${target.id}:`, e)
        }
      }
    }

    // 강등은 됐는데 안내 메일이 아직 못 나간 사용자를 따로 훑는다.
    // 강등되면 위 대상 쿼리에서 빠지므로, 이 정리 루프가 없으면 메일 발송 실패가 영구 미발송이 된다.
    await sendPendingEndedNotices(now)

    // 만료됐지만 갱신 대상이 아닌 계정(1개월권·체험 등)을 정리한다.
    await sweepExpiredNonRenewing(now)
  } catch (e) {
    console.error('[billing-renew] 실행 실패:', e)
  }
}

async function renewOne(target: RenewTarget, now: Date): Promise<void> {
  // 재시도 간격 — 마지막 시도로부터 24시간이 지나지 않았으면 건너뛴다.
  // 이게 없으면 실패한 사용자를 15분마다 다시 긁게 된다.
  if (target.renew_failed_at) {
    const since = now.getTime() - new Date(target.renew_failed_at).getTime()
    if (since < RETRY_INTERVAL_MS) return
  }

  const orderId = `renew_${target.id.slice(0, 8)}_${Date.now()}`
  const result = await chargeWithBillingKey(supabase, target.id, orderId, 'billing-renew')

  // 성공 — applyPaidPlan이 만료일을 30일 뒤로 밀고 실패 상태도 이미 초기화했다.
  // 여기서 다시 한 번 명시적으로 지워 둔다(플랜 반영과 실패 상태 정리를 분리해 읽히게).
  if (result.ok) {
    const { error } = await supabase
      .from('profiles')
      .update({ renew_fail_count: 0, renew_failed_at: null, renew_notified_at: null })
      .eq('id', target.id)
    if (error) console.error(`[billing-renew] 성공 상태 기록 실패 user=${target.id}:`, error)
    console.log(`[billing-renew] 갱신 성공: ${target.id} → ${result.planExpiresAt}`)
    return
  }

  // 실패 — 카운트를 올리고 시도 시각을 남긴다. 플랜은 아직 내리지 않는다.
  const failCount = (target.renew_fail_count ?? 0) + 1
  const { error: failError } = await supabase
    .from('profiles')
    .update({ renew_fail_count: failCount, renew_failed_at: now.toISOString() })
    .eq('id', target.id)
  if (failError) {
    console.error(`[billing-renew] 실패 상태 기록 실패 user=${target.id}:`, failError)
    return // 기록이 안 되면 다음 주기에 무한 재시도가 되므로 여기서 멈춘다
  }
  console.warn(`[billing-renew] 갱신 실패(${failCount}/${MAX_FAIL_COUNT}): ${target.id} code=${result.code}`)

  if (failCount >= MAX_FAIL_COUNT) {
    // 강등은 기존 경로를 그대로 쓴다 — syncUserPlan이 free 전환 + 채널 정리 +
    // 발송 수단 복구를 한 곳에서 처리한다(대상은 이미 만료 상태라 조건을 만족한다).
    await syncUserPlan(target.id)
    console.log(`[billing-renew] 3회 실패 → 무료 강등: ${target.id}`)
    // 안내는 아래 정리 루프가 보낸다(발송 실패 시 다음 주기에 재시도되도록).
    return
  }

  // 첫 실패에만 안내한다. 재시도 중 매번 보내면 같은 내용이 3통 간다.
  // renew_notified_at은 결제 성공 시 null로 초기화되므로 다음 실패 주기에는 다시 발송된다.
  if (failCount === 1 && !target.renew_notified_at) {
    const { to, locale } = await resolveRecipient(target.id, target.email)
    if (!to) {
      console.warn(`[billing-renew] 수신 주소 없음 skip user=${target.id}`)
      return
    }
    // 발송이 예외 없이 끝난 경우에만 플래그를 남긴다 — 실패하면 다음 주기에 재시도된다.
    await sendRenewFailedEmail(to, locale)
    const { error: flagError } = await supabase
      .from('profiles')
      .update({ renew_notified_at: now.toISOString() })
      .eq('id', target.id)
    if (flagError) {
      console.error(`[billing-renew] 안내 플래그 기록 실패(중복 발송 가능) user=${target.id}:`, flagError)
    }
  }
}

// 만료됐는데 갱신 대상이 아닌 Pro 계정(1개월권·체험·해지 예약 등)을 무료로 내린다.
//
// 이들은 지금까지 API를 한 번 태워야(syncUserPlan) 강등됐다. 접속하지 않는 계정은
// plan='pro'인 채로 남아 관리자 통계의 Pro 수가 부풀려 보였다.
// VIP는 만료 개념이 없으므로 plan='pro' 조건에서 자연히 빠진다.
// ※ 체험·1개월권 종료 안내 메일은 cron에서 먼저 도는 runTrialNotifications가 보낸다.
//    여기서는 안내를 보내지 않고 상태만 맞춘다.
async function sweepExpiredNonRenewing(now: Date): Promise<void> {
  const { data: expired, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('plan', 'pro')
    .neq('plan_status', 'active')
    .not('plan_expires_at', 'is', null)
    .lt('plan_expires_at', now.toISOString())

  if (error) {
    console.error('[billing-renew] 만료 정리 대상 조회 실패:', error)
    return
  }

  for (const p of (expired ?? []) as { id: string }[]) {
    try {
      // 강등 경로는 기존 것을 그대로 쓴다(채널 정리·발송 수단 복구 포함).
      await syncUserPlan(p.id)
      console.log(`[billing-renew] 만료 정리 → 무료 강등: ${p.id}`)
    } catch (e) {
      console.error(`[billing-renew] 만료 정리 실패 user=${p.id}:`, e)
    }
  }
}

// 강등됐지만 종료 안내를 아직 못 보낸 사용자에게 발송한다.
// renew_notified_at을 워터마크로 써서 한 번만 나간다.
async function sendPendingEndedNotices(now: Date): Promise<void> {
  const { data: pending, error } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('plan_status', 'none')
    .gte('renew_fail_count', MAX_FAIL_COUNT)
    .is('renew_notified_at', null)

  if (error) {
    console.error('[billing-renew] 종료 안내 대상 조회 실패:', error)
    return
  }

  for (const p of (pending ?? []) as { id: string; email: string | null }[]) {
    try {
      const { to, locale } = await resolveRecipient(p.id, p.email)
      if (!to) {
        console.warn(`[billing-renew] 수신 주소 없음 skip user=${p.id}`)
        continue
      }
      await sendSubEndedEmail(to, locale)
      const { error: flagError } = await supabase
        .from('profiles')
        .update({ renew_notified_at: now.toISOString() })
        .eq('id', p.id)
      if (flagError) {
        console.error(`[billing-renew] 종료 안내 플래그 기록 실패(중복 발송 가능) user=${p.id}:`, flagError)
      } else {
        console.log(`[billing-renew] 종료 안내 발송 완료: ${p.id}`)
      }
    } catch (e) {
      // 발송 실패 시 플래그가 안 남으므로 다음 주기에 재시도된다.
      console.error(`[billing-renew] 종료 안내 발송 실패 user=${p.id}:`, e)
    }
  }
}
