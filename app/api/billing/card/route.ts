import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'

// 등록된 카드 조회 / 삭제 — 본인 것만.
// ★ billing_key는 어느 응답에도 담지 않는다. 화면에 필요한 건 표시명뿐이다.

// 카드 표시명. 자동 갱신 중(plan_status='active')일 때만 내려준다.
// 관리자 토글로 올린 Pro나 VIP는 결제한 것이 아니므로 카드가 보이면 안 된다
// (행은 그대로 둔다 — 나중에 다시 결제하면 그 빌링키를 재사용한다).
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan_status')
    .eq('id', user.id)
    .single()

  if (profile?.plan_status !== 'active') {
    return NextResponse.json({ cardLabel: null })
  }

  const { data } = await serviceClient
    .from('billing_keys')
    .select('card_label')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ cardLabel: data?.card_label ?? null })
}

// 카드 삭제 — 자동 갱신을 중단한다.
//
// 카드가 없으면 갱신 결제를 할 수 없으므로 plan_status를 'onetime'으로 내려
// 갱신 대상(active)에서 빼고, 해지 예약 플래그도 되돌린다(해지 상태와 혼동되지 않게).
// 남은 기간은 그대로 유지된다 — 이미 결제한 몫이다.
//
// 토스에 남은 빌링키는 따로 폐기 호출을 하지 않는다. 우리가 쓰지 않으면 결제가 일어나지 않는다.
export async function DELETE() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { error: deleteError } = await serviceClient
    .from('billing_keys')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    console.error('[billing/card] 카드 삭제 실패:', user.id, deleteError.message)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }

  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan_status')
    .eq('id', user.id)
    .single()

  // 자동 갱신 중이던 사용자만 상태를 옮긴다.
  // 무료·체험 사용자의 plan_status를 결제 상태로 바꿔 놓으면 안 된다.
  if (profile?.plan_status === 'active') {
    const { error: updateError } = await serviceClient
      .from('profiles')
      .update({ plan_status: 'onetime', cancel_at_period_end: false })
      .eq('id', user.id)
    if (updateError) {
      console.error('[billing/card] 플랜 상태 전환 실패:', user.id, updateError.message)
      return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    }
  }

  console.log('[billing/card] 카드 삭제 완료:', user.id)
  return NextResponse.json({ ok: true })
}
