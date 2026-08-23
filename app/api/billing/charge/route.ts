import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { makeOrderId } from '@/lib/billing'
import { chargeWithBillingKey } from '@/lib/billing-charge'

// 자동 갱신(빌링키) 결제 — 등록된 카드로 즉시 1개월분을 청구한다.
//
// 설계 메모
// - body를 받지 않는다. 금액·상품명은 서버 상수다(클라이언트가 정하면 위변조 결제가 된다).
// - orderId도 서버가 만든다. payments.order_id가 unique라 그 값이 멱등성 키가 된다.
// - 실제 결제 실행은 lib/billing-charge.ts에 있다 — 정기 갱신(cron)과 같은 코드를 쓴다.
//   이 라우트가 따로 지는 책임은 "지금 결제해도 되는 사용자인가" 판단뿐이다.
//
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 env는 핸들러 안에서 읽는다.

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 중복 결제 차단 — 이미 유효한 이용 기간이 있으면 청구하지 않는다.
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan, plan_status, plan_expires_at')
    .eq('id', user.id)
    .single()

  if (profile?.plan === 'vip') {
    return NextResponse.json({ error: 'vip' }, { status: 409 })
  }
  const notExpired =
    !!profile?.plan_expires_at && new Date(profile.plan_expires_at) > new Date()
  if (profile?.plan_status === 'active' && notExpired) {
    return NextResponse.json({ error: 'already_active' }, { status: 409 })
  }

  const orderId = makeOrderId(user.id, 'auto')
  const result = await chargeWithBillingKey(serviceClient, user.id, orderId, 'billing/charge')

  if (!result.ok) {
    if (result.code === 'no_card') {
      return NextResponse.json(
        { error: 'no_card', message: '카드를 먼저 등록해 주세요.' },
        { status: 400 }
      )
    }
    const status =
      result.code === 'network_error' ? 502
        : result.code === 'record_failed' || result.code === 'plan_sync_failed' || result.code === 'not_configured' ? 500
          : 400
    return NextResponse.json({ error: result.code, message: result.message }, { status })
  }

  return NextResponse.json({
    ok: true,
    planExpiresAt: result.planExpiresAt,
    receiptUrl: result.receiptUrl,
  })
}
