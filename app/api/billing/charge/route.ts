import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { makeOrderId } from '@/lib/billing'
import { checkPurchaseBlock } from '@/lib/purchase-guard'
import { chargeWithBillingKey } from '@/lib/billing-charge'
import { activateAutoRenew } from '@/lib/plan-sync'

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
  // 화면과 같은 규칙으로 막는다 — 화면에서만 막으면 이 API를 직접 불러 우회할 수 있다.
  const block = checkPurchaseBlock(profile, 'auto')
  if (block) {
    return NextResponse.json({ error: block === 'active_subscription' ? 'already_active' : block }, { status: 409 })
  }

  // 이용 기간이 남아 있으면 지금 결제하지 않는다.
  // 즉시 결제하면 만료일이 now+30일로 다시 계산돼 남은 기간이 사라진다
  // (1개월권 60일 남은 사용자가 자동 갱신을 켜면 60일 → 30일 + 4,900원 청구).
  // 카드 등록만 끝났으므로 자동 갱신만 켜 두고, 결제는 만료일에 runRenewals()가 한다.
  // ★ 화면이 보낸 상태를 믿지 않고 DB의 plan_expires_at으로 직접 판단한다.
  const keepsCurrentPeriod =
    profile?.plan === 'pro' &&
    !!profile.plan_expires_at &&
    new Date(profile.plan_expires_at) > new Date()

  if (keepsCurrentPeriod) {
    try {
      await activateAutoRenew(user.id)
    } catch (e) {
      console.error('[billing/charge] 자동 갱신 전환 실패:', user.id, e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'plan_sync_failed' }, { status: 500 })
    }
    // 결제가 없었으므로 payments에는 아무 행도 남기지 않는다.
    return NextResponse.json({
      ok: true,
      charged: false,
      planExpiresAt: profile!.plan_expires_at,
    })
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
    charged: true,
    planExpiresAt: result.planExpiresAt,
    receiptUrl: result.receiptUrl,
  })
}
