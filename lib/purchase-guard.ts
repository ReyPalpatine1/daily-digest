// 구매 가능 여부 판정 — 화면과 서버가 같은 규칙을 쓰도록 순수 함수로 둔다.
// (env·DB·토스를 건드리지 않으므로 클라이언트에서도 그대로 import한다.
//  화면에서만 막으면 API 직접 호출로 우회되므로 서버 라우트도 반드시 이 함수를 통과시킬 것.)
//
//   현재 상태                   | 자동 갱신 | 1개월권
//   무료·만료                   | 허용      | 허용
//   자동 갱신 중(active)        | 막음      | 막음
//   1개월권·잔여 31일 미만      | 허용      | 허용
//   1개월권·잔여 31일 이상      | 허용      | 막음
//
// 31일 상한의 근거: 구글 플레이 선불 요금제가 "소비되지 않은 충전을 한 번에 하나만" 허용하는 것과 같다.
// 무한 누적을 허용하면 환불 분쟁(1년치를 결제하고 두 달 쓴 시점에 환불 요청)과
// 약관의 이어붙이기 조항(1회 연장을 전제로 쓰인다)이 어긋난다.
export const ONETIME_MAX_REMAINING_DAYS = 31

export type PurchaseKind = 'auto' | 'onetime'

// null이면 구매 가능. 값이 있으면 막힌 이유다.
//   active_subscription : 이미 자동 갱신으로 결제되고 있어 더 살 이유가 없다
//   enough_remaining    : 1개월권 잔여 기간이 충분해 추가 구매를 받지 않는다
export type PurchaseBlock = 'active_subscription' | 'enough_remaining' | null

type PlanFields = {
  plan_status?: string | null
  plan_expires_at?: string | null
}

// 남은 일수. 만료일이 없거나 이미 지났으면 0.
export function remainingDays(planExpiresAt: string | null | undefined, now: Date = new Date()): number {
  if (!planExpiresAt) return 0
  const ms = new Date(planExpiresAt).getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return ms / (24 * 60 * 60 * 1000)
}

export function checkPurchaseBlock(
  profile: PlanFields | null | undefined,
  kind: PurchaseKind,
  now: Date = new Date()
): PurchaseBlock {
  if (!profile) return null

  const remaining = remainingDays(profile.plan_expires_at, now)

  // 자동 갱신 중(기간이 남아 있을 때) — 두 방식 모두 막는다.
  // ※ "해지하고 사라"고 안내하지 않는다. 해지해도 남은 기간은 유지되므로 지금 살 이유가 없다.
  if (profile.plan_status === 'active' && remaining > 0) return 'active_subscription'

  // 1개월권은 잔여가 충분하면 더 받지 않는다. 자동 갱신 전환은 허용한다.
  if (kind === 'onetime' && profile.plan_status === 'onetime' && remaining >= ONETIME_MAX_REMAINING_DAYS) {
    return 'enough_remaining'
  }

  return null
}
