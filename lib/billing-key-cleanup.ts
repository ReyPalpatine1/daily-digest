// 자동갱신 종료 시 빌링키 삭제 (서버 전용) — 개인정보처리방침 제1조 3항.
// ⚠️ service_role 클라이언트를 받으므로 클라이언트 컴포넌트에서 import 금지.
//
// 빌링키와 마스킹된 카드 정보는 자동갱신이 끝나는 때 지체 없이 지운다.
//   · 해지 후 이용기간 만료 / 결제 3회 연속 실패로 무료 전환 → syncUserPlan(lib/plan-sync.ts)
//   · 환불로 자동갱신 해지                                   → applyRefundToAccount(lib/refund-apply.ts)
//   · 카드 삭제(DELETE /api/billing/card), 회원 탈퇴(auth.users CASCADE)는 기존 경로가 지운다.
// ★ 해지 예약 후 만료일 전에는 부르지 말 것 — 해지를 되돌리면 같은 카드로 갱신을 이어 간다.
//
// 실패해도 throw하지 않는다. 플랜 전환·환불 처리는 이미 끝났고, 그 흐름을 되돌릴 이유가 없다.
// 남은 행은 로그로 찾아 수동 정리한다(sql/cleanup_stale_billing_keys.sql 조회문으로도 잡힌다).
// 토스 쪽 빌링키는 따로 폐기 호출하지 않는다(카드 삭제와 같은 기준 — 우리가 쓰지 않으면 결제되지 않는다).
import type { SupabaseClient } from '@supabase/supabase-js'

export async function deleteBillingKey(
  client: SupabaseClient,
  userId: string,
  logTag: string,
  reason: string
): Promise<void> {
  try {
    const { error } = await client.from('billing_keys').delete().eq('user_id', userId)
    if (error) {
      console.error(`[${logTag}] 빌링키 삭제 실패(${reason}) — 수동 정리 필요: user=${userId}:`, error.message)
      return
    }
    console.log(`[${logTag}] 빌링키 삭제(${reason}): ${userId}`)
  } catch (e) {
    console.error(
      `[${logTag}] 빌링키 삭제 실패(${reason}) — 수동 정리 필요: user=${userId}:`,
      e instanceof Error ? e.message : e
    )
  }
}
