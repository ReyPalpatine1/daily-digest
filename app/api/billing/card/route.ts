import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { revokeStoredTossBillingKey } from '@/lib/billing-key-cleanup'

// 등록된 카드 조회 / 삭제 — 본인 것만.
// ★ billing_key는 어느 응답에도 담지 않는다. 화면에 필요한 건 표시명뿐이다.

// 카드 표시명. 등록된 행이 있으면 플랜 상태와 무관하게 내려준다.
// 해지 예약 후 만료일 전에는 카드가 DB에 남아 있으므로(해지 취소 시 재사용),
// 이때 줄을 감추면 사용자는 카드가 지워진 줄 알고 삭제 버튼까지 사라져 지울 수도 없게 된다.
// (자동갱신이 끝나면 lib/billing-key-cleanup.ts 경로로 행 자체가 지워진다)
// "등록된 카드"는 결제된다는 뜻이 아니라 등록 사실만 말한다.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

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
// DB 삭제 전에 토스 빌링키 삭제 API로 토스 쪽 키도 폐기한다. 토스 호출이 실패해도 DB 삭제는 진행한다.
export async function DELETE() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 토스 쪽 빌링키 폐기 — 실패해도 throw하지 않고 아래 DB 삭제를 그대로 진행한다.
  await revokeStoredTossBillingKey(serviceClient, user.id, 'billing/card')

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
