// 플랜 강등/승격에 따른 채널 활성화 동기화 (서버 전용)
// ⚠️ SUPABASE_SERVICE_KEY 를 사용하므로 서버(라우트 핸들러)에서만 import 할 것.
//    클라이언트 컴포넌트에서 import 금지.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { nowUtc } from './time'
import { PERIOD_DAYS } from './billing'

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

// Free 강등 시: PRO 전용 발송 채널(텔레그램 등)을 쓰던 사용자를 이메일로 자동 복구.
// 모든 강등 경로(만료 자동강등 + 관리자 수동강등)에서 공통 호출할 것.
export async function restoreDeliveryToEmail(userId: string): Promise<void> {
  await supabase
    .from('settings')
    .update({ delivery_method: 'email' })
    .eq('user_id', userId)
    .neq('delivery_method', 'email')
}

// 결제 성공 시 유료 플랜 반영 (자동갱신 / 1개월권 공용).
// 만료일 규칙:
//   · auto    : 지금부터 30일 (정기 결제라 주기가 매번 새로 시작한다)
//   · onetime : max(기존 만료일, 지금) + 30일
//     이용약관 제7조 2항 — 만료 전에 다시 구매하면 남은 기간이 소멸하지 않고 뒤에 이어붙는다.
//
// 체험 알림 플래그 4개를 반드시 null로 되돌린다(lib/trial-notify.ts 상단 주석의 요구).
// 리셋하지 않으면 유료 전환 뒤 만료 안내가 다시 나가지 않거나 지난 팝업이 다시 뜬다.
// trial_used는 건드리지 않는다 — 재체험 방지 기록이다.
//
// 갱신 실패 상태(renew_*)도 함께 지운다. 결제가 성공한 순간 이전 실패 이력은 의미가 없고,
// 남겨 두면 강등됐던 사용자가 재구독한 뒤 첫 실패에서 곧바로 다시 강등된다(카운트가 이어짐).
// 종료 안내 워터마크(sub_ended_notified_at)도 같이 지운다. 안 지우면 이번 구독이 또 종료될 때
// 지난 사이클의 워터마크가 남아 있어 종료 안내가 다시 나가지 않는다.
// cancel_at_period_end는 auto일 때만 false로 되돌린다 —
// 해지 예약 상태에서 1개월권을 사면 자동 갱신이 조용히 되살아나면 안 되기 때문이다.
export async function applyPaidPlan(userId: string, kind: 'auto' | 'onetime'): Promise<string> {
  const now = nowUtc()
  let base = now

  if (kind === 'onetime') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan_expires_at')
      .eq('id', userId)
      .single()
    const current = profile?.plan_expires_at ? new Date(profile.plan_expires_at) : null
    // 이미 지난 만료일에 이어붙이면 과거로 계산된다 — 지금보다 미래일 때만 기준으로 삼는다.
    if (current && current > now) base = current
  }

  const expiresAt = new Date(base.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('profiles')
    .update({
      plan: 'pro',
      plan_status: kind === 'auto' ? 'active' : 'onetime',
      plan_expires_at: expiresAt,
      plan_changed_at: now.toISOString(),
      trial_ending_notified_at: null,
      trial_ended_notified_at: null,
      trial_ending_popup_seen_at: null,
      trial_ended_popup_seen_at: null,
      renew_fail_count: 0,
      renew_failed_at: null,
      renew_notified_at: null,
      sub_ended_notified_at: null,
      ...(kind === 'auto' ? { cancel_at_period_end: false } : {}),
    })
    .eq('id', userId)
  if (error) throw new Error(`플랜 반영 실패: ${error.message}`)

  // 무료 강등 때 잠긴 채널을 되살린다.
  await activateAllChannels(userId)

  console.log(`💳 유료 플랜 반영: ${userId} (${kind}) → ${expiresAt}`)
  return expiresAt
}

// 결제 없이 자동 갱신만 켠다 — 이미 이용 기간이 남아 있는 사용자용.
//
// 남은 기간이 있는데 즉시 결제해 버리면 만료일이 now+30일로 "줄어들어" 기간을 빼앗기고
// 돈까지 내는 상태가 된다(1개월권 60일 남은 사용자가 자동 갱신을 켜면 60일 → 30일).
// 그래서 이 경우엔 카드 등록만 하고 결제는 만료일에 runRenewals()가 하도록 넘긴다.
// plan_expires_at은 손대지 않는다 — 줄이지도, 늘리지도 않는다.
// 결제가 일어나지 않았으므로 payments에 행을 만들지 않는 것이 정상이다.
export async function activateAutoRenew(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      plan_status: 'active',
      // 해지 예약 중이었다면 되살린다(다시 자동 갱신을 켠 것이므로).
      cancel_at_period_end: false,
      // 지난 갱신 실패 이력은 새 카드와 무관하다.
      // 종료 안내 워터마크까지 지워야 다음 사이클에 안내가 정상 발송된다.
      renew_fail_count: 0,
      renew_failed_at: null,
      renew_notified_at: null,
      sub_ended_notified_at: null,
    })
    .eq('id', userId)
  if (error) throw new Error(`자동 갱신 전환 실패: ${error.message}`)
  console.log(`🔁 자동 갱신 전환(즉시 결제 없음): ${userId}`)
}

// 만료 체크 + 동기화 (cron/digest에서 호출).
// Pro인데 plan_expires_at 경과 시 free로 강등하고 채널 정리.
//
// ★ 갱신 재시도 대기 중인 계정은 여기서 강등하지 않는다.
//   이 함수는 발송 경로(/api/digest, /api/breaking, /api/preview)에서도 불리고,
//   그중 breaking은 15분 cron마다 대상이 된다. 거기서 "pro + 만료"만 보고 내려 버리면
//   카드 한도가 잠깐 초과된 사용자가 재시도 한 번 없이 15분 만에 잘린다
//   (runRenewals의 3회·24시간 dunning 정책이 통째로 무의미해진다).
//   게다가 한 번 내려가면 plan_status='none'이 되어 runRenewals의 대상 쿼리에 다시 걸리지 않아
//   2·3회째 시도도 영영 일어나지 않고 renew_fail_count가 그대로 얼어붙는다.
//   그래서 "runRenewals가 책임지는 계정"은 그대로 두고, 3회 실패 시 renewOne이
//   downgradeAwaitingRenewal로 직접 내린다.
//   나머지(onetime·trialing·none·해지 예약)는 종전대로 여기서 내린다 —
//   해지 예약 만료 계정은 sweepExpiredCanceled가 이 함수를 그대로 호출한다.
export async function syncUserPlan(
  userId: string,
  opts: { downgradeAwaitingRenewal?: boolean } = {}
): Promise<'free' | 'pro' | 'vip'> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, plan_status, cancel_at_period_end')
    .eq('id', userId)
    .single()

  if (!profile) return 'free'

  if (profile.plan === 'pro' && profile.plan_expires_at) {
    const isExpired = new Date(profile.plan_expires_at) < nowUtc()

    // runRenewals의 갱신 대상 쿼리(lib/billing-renew.ts)와 정확히 같은 조건으로 맞춘다.
    // 보호 범위가 책임 범위보다 넓으면 아무도 내리지 않는 계정이 만료된 채 Pro로 남는다.
    // (cancel_at_period_end는 NOT NULL DEFAULT false — sql/renewal_columns.sql)
    const awaitingRenewal =
      profile.plan_status === 'active' && profile.cancel_at_period_end === false

    if (isExpired && awaitingRenewal && !opts.downgradeAwaitingRenewal) {
      // 지금까지 이 경로는 로그가 없어 "왜 강등됐는지"를 사후에 추적할 수 없었다.
      console.log(
        `⏸️ 갱신 대기 중이라 만료 강등 보류: ${userId} ` +
          `(expires=${profile.plan_expires_at}, plan_status=active, 해지예약=false) → runRenewals가 처리`
      )
      return 'pro' // 위 조건에서 plan='pro'가 보장된다
    }

    if (isExpired) {
      await supabase
        .from('profiles')
        .update({ plan: 'free', plan_expires_at: null, plan_status: 'none', plan_changed_at: nowUtc().toISOString() })
        .eq('id', userId)
      await enforceChannelLimit(userId)
      await restoreDeliveryToEmail(userId)
      console.log(`📉 Plan 만료 강등: ${userId}`)
      return 'free'
    }
  }

  return (profile.plan as 'free' | 'pro' | 'vip') ?? 'free'
}
