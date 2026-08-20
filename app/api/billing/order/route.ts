import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { PRICE_MONTHLY, ORDER_NAME, makeOrderId } from '@/lib/billing'

// 1개월권(단건 결제) 주문번호 발급 — 결제창을 열기 "전에" 서버가 주문을 만들어 둔다.
//
// 왜 서버가 만드나
// - 클라이언트가 만든 orderId를 신뢰하면 남의 주문번호를 재사용하거나 금액이 다른 주문에
//   붙일 수 있다. order_id는 unique라 이 값이 곧 멱등성 키다.
// - 승인 단계(/api/billing/confirm)에서 "우리가 저장한 금액"과 대조하기 위해,
//   결제창을 열기 전에 금액을 pending으로 못박아 둔다. 이게 금액 위변조 방어의 기준점이다.
//
// 자동 갱신과 달리 1개월권은 이미 이용 중이어도 다시 살 수 있다(남은 기간 뒤에 이어붙는다).

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const orderId = makeOrderId(user.id, 'onetime')

  const { error } = await serviceClient.from('payments').insert({
    user_id: user.id,
    order_id: orderId,
    amount: PRICE_MONTHLY,
    kind: 'onetime',
    status: 'pending',
  })
  if (error) {
    console.error('[billing/order] payments 기록 실패:', user.id, error.message)
    return NextResponse.json({ error: 'record_failed' }, { status: 500 })
  }

  return NextResponse.json({ orderId, amount: PRICE_MONTHLY, orderName: ORDER_NAME })
}
