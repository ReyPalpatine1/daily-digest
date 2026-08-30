// 환불 자격 판정 — 환불정책 제3조가 정한 기준을 코드로 옮긴 것이다.
//
// ★ 이 파일의 판정 기준은 약관이 확정한 것이다. 임의로 바꾸면 문서와 실제 동작이 어긋난다.
//   바꿔야 한다면 환불정책(lib/legal/content.ts의 REFUND_KO)을 먼저 고칠 것.
//
// 자격 조회(GET)와 환불 실행(POST)이 같은 함수를 부른다 — 두 곳에 규칙을 따로 쓰면
// 화면이 "환불 가능"을 보여준 뒤 서버가 거절하는 어긋남이 생긴다.
import type { SupabaseClient } from '@supabase/supabase-js'

// 환불 대상 결제. 화면 안내(금액·결제일)와 실행(id·금액·paymentKey)에 모두 쓴다.
export type RefundTargetPayment = {
  id: string
  amount: number
  createdAt: string
  // 토스 결제 취소 호출에 필요하다. 저장돼 있지 않을 수 있어 null을 허용한다.
  paymentKey: string | null
}

export type RefundEligibility =
  | { ok: true; payment: RefundTargetPayment }
  | { ok: false; reason: 'expired' | 'used' | 'no_payment' }

// 결제 1건이 부여하는 이용 기간. lib/billing.ts의 PERIOD_DAYS와 같은 값이며,
// 환불 시 차감할 일수이기도 하다(환불정책 제4조 4항).
export const REFUND_PERIOD_DAYS = 30

// 청약철회 가능 기간(환불정책 제3조 5항).
// 초일불산입 — 결제 당일은 세지 않고, 결제일 다음 날부터 7일째의 24시(KST)까지다.
const WITHDRAWAL_DAYS = 7

// 이용 개시로 보는 발송 유형(환불정책 제3조 4항).
// 'admin'·'welcome'·'error'는 제외한다 — 회사가 임의로 보낸 것은 사용으로 보지 않는다.
// 'digest'만 세면 안 된다. 속보·미리보기도 유료 전용 기능의 이용 개시에 해당한다.
// (텔레그램 발송도 같은 테이블에 같은 type으로 기록되므로 메신저 수신까지 함께 걸린다)
const USAGE_LOG_TYPES = ['digest', 'breaking', 'preview'] as const

// 청약철회 마감 시각(ms).
//
// "결제 시각 + 7일"이 아니다. 결제 당일을 세지 않으므로, 결제일의 KST 자정에서
// (7 + 1)일 뒤가 마감이 된다. 예) 8/1 23:50 결제 → 8/2부터 기산 → 8/8 24:00까지.
//
// KST 자정을 구할 때 로컬 타임존을 쓰면 서버 위치에 따라 하루가 밀린다.
// 서버는 UTC로 도는 Workers이므로 +9시간을 더해 KST 달력 날짜를 뽑고,
// 그 날짜의 자정을 다시 UTC 기준 시각으로 되돌린다.
export function withdrawalDeadlineMs(paidAtIso: string): number {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const DAY_MS = 24 * 60 * 60 * 1000
  const paidMs = Date.parse(paidAtIso)
  if (Number.isNaN(paidMs)) return NaN
  // KST 기준 그 날의 자정(= UTC 시각)
  const kstMidnightMs = Math.floor((paidMs + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS
  return kstMidnightMs + (WITHDRAWAL_DAYS + 1) * DAY_MS
}

// 환불 자격 판정. service_role 클라이언트로 호출할 것(payments·email_logs는 본인 행만
// 걸러야 하는데 RLS에 기대지 않고 user_id로 명시적으로 좁힌다).
export async function checkRefundEligibility(
  serviceClient: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<RefundEligibility> {
  // 1. 대상 결제 — 아직 환불하지 않은 성공 결제 중 가장 최근 1건(환불정책 제3조 6항).
  //    그 이전 결제는 청약철회 기간이 이미 지났으므로 애초에 대상이 아니다.
  const { data: paymentRow, error: paymentError } = await serviceClient
    .from('payments')
    .select('id, amount, created_at, payment_key')
    .eq('user_id', userId)
    .eq('status', 'done')
    .is('refunded_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (paymentError) {
    // 조회가 실패했는데 "환불 가능"이라고 답하면 자격 없는 환불이 나갈 수 있다.
    // 없는 것으로 보아 막는 쪽이 안전하다.
    console.error('[refund] 대상 결제 조회 실패:', userId, paymentError.message)
    return { ok: false, reason: 'no_payment' }
  }
  if (!paymentRow) return { ok: false, reason: 'no_payment' }

  const payment: RefundTargetPayment = {
    id: paymentRow.id as string,
    amount: (paymentRow.amount as number) ?? 0,
    createdAt: paymentRow.created_at as string,
    paymentKey: (paymentRow.payment_key as string | null) ?? null,
  }

  // 2. 청약철회 기간(환불정책 제3조 5항).
  const deadlineMs = withdrawalDeadlineMs(payment.createdAt)
  if (Number.isNaN(deadlineMs) || nowMs > deadlineMs) {
    return { ok: false, reason: 'expired' }
  }

  // 3. 이용 개시 여부(환불정책 제3조 4항).
  //    결제 이후의 성공 발송만 센다 — 결제 이전 발송(Pro 체험 중 포함)은 산입하지 않는다.
  const { count, error: logError } = await serviceClient
    .from('email_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('type', USAGE_LOG_TYPES)
    .eq('status', 'success')
    .gt('sent_at', payment.createdAt)

  if (logError) {
    // 발송 여부를 확인하지 못한 채 환불하면, 이미 제공된 콘텐츠를 무상으로 준 셈이 된다.
    // 사용한 것으로 보아 막고, 사용자는 안내에 따라 메일로 문의할 수 있다.
    console.error('[refund] 발송 기록 조회 실패:', userId, logError.message)
    return { ok: false, reason: 'used' }
  }
  if ((count ?? 0) > 0) return { ok: false, reason: 'used' }

  return { ok: true, payment }
}
