// 환불 후 계정 처리 (서버 전용) — 토스 취소가 끝난 결제 1건을 계정에 반영한다.
// ⚠️ service_role 클라이언트를 받으므로 클라이언트 컴포넌트에서 import 금지.
//
// 호출부는 두 곳이다.
//   · POST /api/billing/refund  : 프로필 환불 — 토스 취소 성공 직후.
//   · POST /api/billing/webhook : 상점관리자에서 직접 취소 — 토스 조회로 CANCELED를 확인한 뒤.
// 같은 결제에 둘이 거의 동시에 들어와도(프로필 환불 직후 그 건의 웹훅) 한 번만 처리돼야 한다.
//
// ★ 이중 처리 방지는 "잠금 먼저"다.
//   update payments set refunded_at = now() where id = ? and refunded_at is null
//   은 DB가 한 행에 대해 원자적으로 처리하므로, 동시에 들어온 두 요청 중 한쪽만 행을 갱신한다.
//   갱신된 행이 없으면 다른 요청이 이미 처리한 것 → 계정을 건드리지 않고 성공으로 끝낸다.
//   (예전 순서 "확인 → 차감 → 기록"은 확인과 기록 사이에 다른 요청이 끼면 30일이 두 번 빠졌다)
// ★ 잠근 뒤 계정 처리가 실패해도 잠금을 되돌리지 않는다 — 돈은 이미 돌려준 상태이고,
//   되돌리면 재시도가 30일을 또 뺄 수 있다. 대신 수동 확인용 로그를 남긴다.
// ★ payments.status는 'done' 그대로 두고 refunded_at으로만 환불을 표시한다(기존 데이터와 같은 규칙).
import type { SupabaseClient } from '@supabase/supabase-js'
import { REFUND_PERIOD_DAYS } from './refund-eligibility'
import { enforceChannelLimit, restoreDeliveryToEmail } from './plan-sync'

const DAY_MS = 24 * 60 * 60 * 1000

// 환불 후 남는 이용 기간(ISO). 이 결제가 부여한 30일을 만료일에서 빼고,
// 그러고도 지금보다 미래면 그 시각을, 아니면 null(즉시 무료 전환)을 돌려준다.
export function refundedExpiresAt(planExpiresAt: string | null, nowMs: number): string | null {
  const expiresMs = planExpiresAt ? Date.parse(planExpiresAt) : NaN
  // 만료일이 없거나 깨져 있으면 남은 기간을 계산할 수 없다 — 차감 결과를 0으로 보아 내린다.
  if (Number.isNaN(expiresMs)) return null
  const reducedMs = expiresMs - REFUND_PERIOD_DAYS * DAY_MS
  return reducedMs > nowMs ? new Date(reducedMs).toISOString() : null
}

export type ApplyRefundResult =
  // alreadyApplied: 잠금이 이미 걸려 있었다(다른 요청이 처리함) — 계정은 건드리지 않았다.
  | { ok: true; alreadyApplied: boolean; expiresAfter: string | null }
  // lock    : 잠금 시도 자체가 실패 — 아무것도 바뀌지 않았으므로 재시도하면 처리될 수 있다.
  // profile : 잠금 후 프로필 조회 실패 — 잠금은 걸렸다(수동 확인 필요).
  // update  : 잠금 후 플랜 차감 실패 — 잠금은 걸렸다(수동 확인 필요).
  | { ok: false; stage: 'lock' | 'profile' | 'update' }

// logTag: 로그 접두어(예: 'billing/refund'). 어느 경로에서 처리됐는지 구분한다.
export async function applyRefundToAccount(
  serviceClient: SupabaseClient,
  params: { paymentId: string; userId: string; logTag: string },
): Promise<ApplyRefundResult> {
  const { paymentId, userId, logTag } = params

  // 1. 잠금 — 환불 이력 기록이 곧 이중 처리 방지 잠금이다.
  const { data: locked, error: lockError } = await serviceClient
    .from('payments')
    .update({ refunded_at: new Date().toISOString() })
    .eq('id', paymentId)
    .is('refunded_at', null)
    .select('id')

  if (lockError) {
    console.error(`[${logTag}] 환불 잠금 실패(계정 무변경): payment=${paymentId} user=${userId}:`, lockError.message)
    return { ok: false, stage: 'lock' }
  }
  if (!locked || locked.length === 0) {
    console.warn(`[${logTag}] 이미 처리된 환불 — 계정 차감 생략: payment=${paymentId} user=${userId}`)
    return { ok: true, alreadyApplied: true, expiresAfter: null }
  }

  const lockedButFailed = (reason: string, detail?: string) => {
    console.error(
      `[${logTag}] ⚠️ 환불 잠금은 걸렸으나 계정 처리 실패 — 수동 확인 필요(${reason}): payment=${paymentId} user=${userId}:`,
      detail ?? '',
    )
  }

  // 2. 계정 처리 — 이 결제가 부여한 30일을 이용 기간에서 뺀다(환불정책 제4조 4항).
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('plan, plan_status, plan_expires_at')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    lockedButFailed('프로필 조회 실패', profileError?.message)
    return { ok: false, stage: 'profile' }
  }

  const nowMs = Date.now()
  const expiresAfter = refundedExpiresAt((profile.plan_expires_at as string | null) ?? null, nowMs)

  // 자동 갱신 중이었다면 함께 해지한다. 카드를 남기는 것은 기존 해지 기능과 같다 —
  // 환불은 그 결제를 무르는 것이지 계정을 정리하는 것이 아니다.
  const cancelAutoRenew = profile.plan_status === 'active'

  // 차감하고도 기간이 남으면 Pro를 유지한다(1개월권을 이어 붙여 기간이 쌓인 경우).
  const update: Record<string, unknown> = expiresAfter
    ? {
        plan_expires_at: expiresAfter,
        ...(cancelAutoRenew ? { plan_status: 'onetime', cancel_at_period_end: false } : {}),
      }
    : {
        plan: 'free',
        plan_status: 'none',
        plan_expires_at: null,
        plan_changed_at: new Date().toISOString(),
        ...(cancelAutoRenew ? { cancel_at_period_end: false } : {}),
      }

  const { error: updateError } = await serviceClient
    .from('profiles')
    .update(update)
    .eq('id', userId)

  if (updateError) {
    lockedButFailed('플랜 차감 실패', updateError.message)
    return { ok: false, stage: 'update' }
  }

  // 3. 무료로 내려간 경우에만 강등 정리를 함께 한다.
  //    cron의 만료 정리는 "만료일이 지난 pro"를 찾으므로 이미 free인 계정은 영영 대상이 아니다 —
  //    여기서 하지 않으면 채널이 7개 모두 활성인 채 free로 남는다.
  //    기간이 남아 Pro가 유지되는 환불에서는 부르지 않는다 — 여전히 Pro이므로 채널을 잠그면 안 된다.
  //    실패해도 환불은 성공 처리한다(돈은 이미 처리됨). 로그로 수동 확인이 가능하게 한다.
  if (!expiresAfter) {
    try {
      await enforceChannelLimit(userId)
      await restoreDeliveryToEmail(userId)
    } catch (e) {
      console.error(
        `[${logTag}] ⚠️ 무료 강등 정리 실패(플랜은 free로 내려감 — 채널/발송 수동 확인 필요): user=${userId}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  return { ok: true, alreadyApplied: false, expiresAfter }
}
