// 빌링키 파기 (서버 전용) — 개인정보처리방침 제1조 3항.
// ⚠️ service_role 클라이언트·TOSS_SECRET_KEY 를 쓰므로 클라이언트 컴포넌트에서 import 금지.
//
// 빌링키와 마스킹된 카드 정보는 자동갱신이 끝나는 때 지체 없이 지운다. 우리 DB 행을 지우기 전에
// 토스 빌링키 삭제 API(DELETE /v1/billing/{billingKey})로 토스 쪽 빌링키도 함께 폐기한다.
//   https://docs.tosspayments.com/reference#빌링키-삭제 — 성공 시 빈 body + 200, 실패 시 { code, message }.
//
// 호출 지점
//   · 해지 후 이용기간 만료 / 결제 3회 연속 실패로 무료 전환 → syncUserPlan(lib/plan-sync.ts) → deleteBillingKey
//   · 환불로 자동갱신 해지                                   → applyRefundToAccount(lib/refund-apply.ts) → deleteBillingKey
//   · 카드 삭제                                             → DELETE /api/billing/card → revokeStoredTossBillingKey
//   · 회원 탈퇴(행은 auth.users CASCADE 로 삭제)              → POST /api/account/delete → revokeStoredTossBillingKey
//   · 카드 변경으로 기존 키를 덮어쓸 때                       → POST /api/billing/authorize → revokeTossBillingKey(이전 키)
// ★ 해지 예약 후 만료일 전에는 부르지 말 것 — 해지를 되돌리면 같은 카드로 갱신을 이어 간다.
//
// ★ 토스 호출이 실패해도 우리 DB 삭제는 진행한다(우리 쪽 파기가 우선). 실패 로그에는 회원 ID·에러 코드만 남긴다
//   (빌링키 값·토스 응답 전문은 절대 로그에 남기지 않는다).
// ★ 이 파일의 함수는 throw하지 않는다 — 플랜 전환·환불·탈퇴 흐름을 토스 호출 실패로 막지 않기 위해서다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOSS_API, tossAuthHeader } from './billing'

// 토스 쪽 빌링키 폐기. 성공 여부만 돌려준다(호출부는 결과와 무관하게 진행한다).
export async function revokeTossBillingKey(
  billingKey: string,
  userId: string,
  logTag: string
): Promise<boolean> {
  // 자동결제(빌링) 계약 시크릿 — 발급(/api/billing/authorize)·승인과 같은 키. 호출 시점에 읽는다.
  const authHeader = tossAuthHeader('billing')
  if (!authHeader) {
    console.error(`[${logTag}] 토스 빌링키 삭제 실패: user=${userId} code=not_configured`)
    return false
  }
  try {
    const res = await fetch(`${TOSS_API}/billing/${encodeURIComponent(billingKey)}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    })
    if (res.ok) {
      console.log(`[${logTag}] 토스 빌링키 삭제 완료: user=${userId}`)
      return true
    }
    const body = await res.json().catch(() => ({})) as { code?: string }
    console.error(`[${logTag}] 토스 빌링키 삭제 실패: user=${userId} code=${body.code ?? res.status}`)
    return false
  } catch {
    console.error(`[${logTag}] 토스 빌링키 삭제 실패: user=${userId} code=network_error`)
    return false
  }
}

// 우리 DB에 저장된 이 회원의 빌링키를 토스에서 폐기한다(DB 행은 건드리지 않는다).
// 행이 없거나 조회에 실패하면 아무 것도 하지 않는다.
export async function revokeStoredTossBillingKey(
  client: SupabaseClient,
  userId: string,
  logTag: string
): Promise<void> {
  try {
    const { data, error } = await client
      .from('billing_keys')
      .select('billing_key')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error(`[${logTag}] 토스 빌링키 삭제 실패: user=${userId} code=lookup_failed`)
      return
    }
    const billingKey = (data?.billing_key as string | null | undefined) ?? null
    if (!billingKey) return
    await revokeTossBillingKey(billingKey, userId, logTag)
  } catch {
    console.error(`[${logTag}] 토스 빌링키 삭제 실패: user=${userId} code=lookup_failed`)
  }
}

// 자동갱신 종료 시: 토스 빌링키 폐기 → 우리 DB 행 삭제.
export async function deleteBillingKey(
  client: SupabaseClient,
  userId: string,
  logTag: string,
  reason: string
): Promise<void> {
  await revokeStoredTossBillingKey(client, userId, logTag)
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
