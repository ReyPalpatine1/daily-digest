import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'

// 결제 내역 조회 — 본인 것만.
// ★ payment_key / fail_code / fail_message / order_id 는 어느 응답에도 담지 않는다.
//   화면에 필요한 건 날짜·금액·구분·성패·영수증 링크뿐이다.
//
// status를 'done'·'failed'로만 한정하는 이유:
//   · pending  — 사용자가 결제창을 닫으면 그대로 쌓이는 미완료 주문이다. 결제된 적이 없다.
//   · canceled — confirm/route.ts의 구매 제한 거부 한 곳에서만 찍힌다. 토스에 승인 요청을
//                보내기 전에 막은 것이라 청구가 발생하지 않은 주문인데, "취소됨"으로 보이면
//                환불로 오해된다. 나중에 결제 취소 API를 붙이면 실제 환불 건과 같은 값에 섞인다.
//   · failed   — 남긴다. 카드 문제를 사용자가 알고 조치해야 하며,
//                자동 갱신 실패도 여기에만 기록된다.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data, error } = await serviceClient
    .from('payments')
    .select('created_at, amount, kind, status, receipt_url')
    .eq('user_id', user.id)
    .in('status', ['done', 'failed'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[billing/payments] 조회 실패:', user.id, error.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }

  const payments = (data ?? []).map((row) => ({
    createdAt: row.created_at as string,
    amount: row.amount as number,
    kind: row.kind as string,
    status: row.status as string,
    receiptUrl: (row.receipt_url as string | null) ?? null,
  }))

  return NextResponse.json({ payments })
}
