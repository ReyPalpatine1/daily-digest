// 탈퇴 회원 결제 기록 분리 보관(payments_archive) — sql/payments_archive.sql 참고.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { toZoned } from './time'

// 결제 기록 법정 보존 기간(전자상거래법 — 대금결제 기록 5년).
const RETENTION_YEARS = 5

type PaymentRow = {
  order_id: string
  payment_key: string | null
  amount: number
  kind: string
  status: string
  method: string | null
  created_at: string
  refunded_at: string | null
}

// 탈퇴 회원의 결제 기록을 payments_archive로 옮기고 원본을 지운다.
// 실패하면 throw — 호출부(탈퇴 API)는 탈퇴를 중단해야 한다.
// 이관 없이 원본만 지워지면(auth 삭제 시 CASCADE) 법정 보존 의무를 어기게 된다.
//
// - 승인 실패(failed) 건은 대금결제 기록이 아니므로 옮기지 않는다.
//   pending은 "승인됐는데 마감 기록만 실패한" 건일 수 있어 함께 옮긴다.
// - order_id 기준 upsert(중복 무시)라 이전 탈퇴 시도가 중간에 실패했어도 다시 시도할 수 있다.
export async function archiveUserPayments(
  client: SupabaseClient,
  userId: string,
  email: string | null
): Promise<number> {
  const { data, error } = await client
    .from('payments')
    .select('order_id, payment_key, amount, kind, status, method, created_at, refunded_at')
    .eq('user_id', userId)
    .neq('status', 'failed')
  if (error) throw new Error(`payments 조회 실패: ${error.message}`)

  const rows = (data ?? []) as PaymentRow[]
  if (rows.length > 0) {
    const { error: insertError } = await client
      .from('payments_archive')
      .upsert(
        rows.map(r => ({
          order_id: r.order_id,
          payment_key: r.payment_key,
          amount: r.amount,
          currency: 'KRW',
          kind: r.kind,
          status: r.status,
          method: r.method,
          email,
          paid_at: r.created_at,
          refunded_at: r.refunded_at,
        })),
        { onConflict: 'order_id', ignoreDuplicates: true }
      )
    if (insertError) throw new Error(`payments_archive 이관 실패: ${insertError.message}`)

    // 이관 확인 — 옮긴 주문번호가 전부 보관 테이블에 있어야 원본을 지운다.
    const orderIds = rows.map(r => r.order_id)
    const { count, error: countError } = await client
      .from('payments_archive')
      .select('order_id', { count: 'exact', head: true })
      .in('order_id', orderIds)
    if (countError) throw new Error(`payments_archive 이관 확인 실패: ${countError.message}`)
    if (count !== orderIds.length) {
      throw new Error(`payments_archive 이관 누락: ${count ?? 0}/${orderIds.length}건`)
    }
  }

  // 원본 삭제. 실패해도 이관은 끝났고, auth 계정 삭제 시 CASCADE로 지워지므로 로깅만 한다.
  const { error: deleteError } = await client.from('payments').delete().eq('user_id', userId)
  if (deleteError) console.error('[payments-archive] 원본 payments 삭제 실패:', deleteError.message)

  return rows.length
}

// 결제일로부터 5년이 지난 보관 기록을 파기한다. 매월 1일(KST)에만 실행한다.
// 크론이 하루에도 여러 번 불러도 같은 조건의 삭제라 멱등이다.
export async function cleanupExpiredPaymentArchive(): Promise<void> {
  if (toZoned(new Date()).day !== 1) return
  try {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
    const cutoff = new Date()
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION_YEARS)
    const { data, error } = await client
      .from('payments_archive')
      .delete()
      .lt('paid_at', cutoff.toISOString())
      .select('id')
    if (error) {
      console.error(`[payments-archive] 보관 기록 정리 실패: ${error.message}`)
    } else {
      console.log(`[payments-archive] 보관 기록 정리: ${data?.length ?? 0}건 삭제`)
    }
  } catch (e) {
    console.error('[payments-archive] 보관 기록 정리 예외:', e)
  }
}
