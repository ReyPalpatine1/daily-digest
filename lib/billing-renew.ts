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
import { PERIOD_DAYS } from './billing'
import { sendAdminBillingAlert } from './admin-alert'
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
// 결제-플랜 대조(reconcile) 조회 범위. 한 주기(30일)에 여유를 둔 값이다.
const RECONCILE_WINDOW_DAYS = 35

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

    // 결제는 됐는데 플랜이 그만큼 반영되지 않은 계정을 대조해 관리자에게 알린다(자동 복구 없음).
    await reconcilePaidPlans(now)
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

  // 우리 쪽에서 마감되지 않은 최근 결제가 남아 있으면 다시 긁지 않는다.
  //
  // 왜 필요한가: 아래 plan_sync_failed 분기는 renew_failed_at을 남기지 않는다(이미 승인된 결제를
  // 실패로 세지 않기 위해서다). 그러면 위의 24시간 재시도 간격이 걸리지 않아 15분마다 재청구되어
  // 이중 결제가 난다 — 그 구멍을 여기서 막는다. order_id는 매번 새로 만들어지므로
  // payments.order_id의 unique 제약만으로는 막히지 않는다.
  //
  // 정상 갱신은 성공 즉시 만료일이 30일 뒤로 밀려 대상 쿼리에서 빠지므로 이 가드에 걸리지 않는다.
  // 승인 실패('failed')는 대상이 아니므로 기존 24시간 재시도 흐름도 그대로다.
  const { data: unsettled, error: unsettledError } = await supabase
    .from('payments')
    .select('order_id, status')
    .eq('user_id', target.id)
    .in('status', ['pending', 'done'])
    .gte('created_at', new Date(now.getTime() - RETRY_INTERVAL_MS).toISOString())
    .limit(1)

  if (unsettledError) {
    // 확인이 안 되면 긁지 않는다 — 갱신이 하루 늦는 것보다 이중 청구가 훨씬 무겁다.
    console.error(`[billing-renew] 최근 결제 조회 실패 → 재청구 보류 user=${target.id}:`, unsettledError)
    return
  }
  if (unsettled?.length) {
    const row = unsettled[0] as { order_id: string; status: string }
    console.warn(
      `[billing-renew] 최근 결제가 남아 있어 재청구 보류: user=${target.id} order=${row.order_id} status=${row.status}`
    )
    return
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

  // ★ 승인은 났는데 플랜 반영(applyPaidPlan)만 실패한 경우 — 이건 "결제 실패"가 아니다.
  //   카드 결제 실패와 똑같이 다루면 두 가지가 동시에 잘못된다.
  //     · renew_fail_count가 올라가 승인된 결제가 실패로 집계되고, 3회면 무료로 강등된다.
  //     · renew_failed_at으로 재시도 대상이 되어, 이미 낸 돈에 24시간 뒤 또 청구된다.
  //   그래서 둘 다 기록하지 않고 관리자에게 알린 뒤 이 사용자만 건너뛴다.
  //   payments는 'pending'에 멈춰 있어 위의 재청구 보류 가드가 다음 주기부터 막아 준다.
  if (result.code === 'plan_sync_failed') {
    console.error(
      `[billing-renew] 승인됐으나 플랜 반영 실패(수동 확인 필요): user=${target.id} order=${orderId}`
    )
    await sendAdminBillingAlert({
      reason: 'plan_sync_failed',
      userId: target.id,
      orderId,
      headline: '결제는 승인됐으나 플랜이 반영되지 않았습니다',
      lines: [
        `user_id: ${target.id}`,
        `order_id: ${orderId}`,
        '정기 갱신 결제가 토스에서 승인된 뒤 applyPaidPlan이 실패했습니다.',
        'payments는 pending으로 남아 있고, 이중 청구를 막기 위해 실패 횟수·재시도 시각은 기록하지 않았습니다.',
        '토스 결제 내역과 profiles의 플랜을 대조해 수동으로 맞춰 주세요.',
      ],
    })
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

type DonePayment = {
  user_id: string | null
  order_id: string
  created_at: string
}

// 결제 기록과 플랜 상태를 대조해 어긋난 계정을 관리자에게 알린다.
//
// 왜 필요한가
//   payments와 profiles는 별개 쿼리이고 트랜잭션 경계가 없다. 그런데 지금까지 정리 로직은
//   "pro인데 만료됨 → free" 한 방향만 봤고, 반대 방향("결제됐는데 free")은 아무도 보지 않았다.
//   그래서 결제 후 플랜이 날아간 사고가 자가 치유되지 않고 그대로 남았다. 이 대조가 안전망이다.
//
// ★ 자동 복구는 하지 않는다.
//   환불 처리처럼 관리자가 의도적으로 강등한 경우를 되돌리면 안 되므로, 알림만 보내고 판단은 사람이 한다.
//
// 반복 발송 방지는 sendAdminBillingAlert가 order_id를 워터마크로 삼아 처리한다(건당 1회).
async function reconcilePaidPlans(now: Date): Promise<void> {
  const since = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 24 * HOUR_MS).toISOString()

  const { data: payments, error } = await supabase
    .from('payments')
    .select('user_id, order_id, created_at')
    .eq('status', 'done')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[billing-renew] 결제 대조 대상 조회 실패:', error)
    return
  }

  // 사용자별 최신 결제 1건만 본다 — 한 사람에게 결제 수만큼 알림이 가지 않게 한다.
  // 최신순으로 정렬돼 있으므로 처음 만난 행이 그 사용자의 최신 결제다.
  const latestByUser = new Map<string, { orderId: string; paidAt: Date }>()
  for (const p of (payments ?? []) as DonePayment[]) {
    if (!p.user_id || latestByUser.has(p.user_id)) continue
    latestByUser.set(p.user_id, { orderId: p.order_id, paidAt: new Date(p.created_at) })
  }
  if (latestByUser.size === 0) return

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, plan, plan_expires_at')
    .in('id', Array.from(latestByUser.keys()))

  if (profileError) {
    console.error('[billing-renew] 결제 대조 프로필 조회 실패:', profileError)
    return
  }

  const profileById = new Map<string, { plan: string | null; plan_expires_at: string | null }>()
  for (const p of (profiles ?? []) as { id: string; plan: string | null; plan_expires_at: string | null }[]) {
    profileById.set(p.id, { plan: p.plan, plan_expires_at: p.plan_expires_at })
  }

  for (const [userId, paid] of latestByUser) {
    try {
      // 그 결제가 보장하는 이용 기간의 끝. 이미 지났으면 free여도 정상이라 대조 대상이 아니다
      // (조회 범위를 35일로 잡은 것은 여유일 뿐이고, 판정은 이 30일 기준으로 한다).
      const expectedExpiry = new Date(paid.paidAt.getTime() + PERIOD_DAYS * 24 * HOUR_MS)
      if (expectedExpiry <= now) continue

      const profile = profileById.get(userId)
      if (!profile) continue // 탈퇴 등으로 프로필이 없는 경우 — 대조할 대상이 없다

      const expiresAt = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null
      // VIP와 만료 없는 Pro(관리자 지정)는 결제분 이상을 보장하므로 정상으로 본다.
      const coversPaidPeriod =
        (profile.plan === 'pro' || profile.plan === 'vip') &&
        (!expiresAt || expiresAt >= expectedExpiry)
      if (coversPaidPeriod) continue

      console.warn(
        `[billing-renew] 결제-플랜 불일치: user=${userId} order=${paid.orderId} ` +
          `plan=${profile.plan} expires=${profile.plan_expires_at} expected>=${expectedExpiry.toISOString()}`
      )
      await sendAdminBillingAlert({
        reason: 'plan_not_applied',
        userId,
        orderId: paid.orderId,
        headline: '결제 내역이 있는데 플랜이 반영돼 있지 않습니다',
        lines: [
          `user_id: ${userId}`,
          `order_id: ${paid.orderId}`,
          `결제 시각: ${paid.paidAt.toISOString()}`,
          `보장돼야 할 만료일: ${expectedExpiry.toISOString()} 이후`,
          `현재 플랜: ${profile.plan ?? '(없음)'} / 만료일: ${profile.plan_expires_at ?? '(없음)'}`,
          '환불 등으로 의도적으로 내린 계정이면 무시해 주세요. 자동 복구는 하지 않습니다.',
        ],
      })
    } catch (e) {
      // 한 명의 실패가 나머지 대조를 막지 않게 한다.
      console.error(`[billing-renew] 결제 대조 실패 user=${userId}:`, e)
    }
  }
}
