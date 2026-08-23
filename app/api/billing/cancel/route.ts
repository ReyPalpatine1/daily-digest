import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'

// 자동 갱신 해지 / 되돌리기 — 본인 것만.
//
// ★ 즉시 무료로 내리지 않는다. 이미 결제한 기간은 끝까지 이용할 수 있어야 한다(약관 기준).
//   cancel_at_period_end=true로 예약만 걸어 두면, 만료일에 cron(runRenewals)이 재결제 대상에서
//   제외해 그대로 종료된다. 그 뒤 만료 처리는 기존 syncUserPlan 경로가 맡는다.
//
// body: { cancel: boolean } — true면 해지 예약, false면 되돌리기(같은 라우트에서 처리).

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { cancel?: boolean } | null
  // 값을 안 보내면 해지로 본다(이 라우트의 기본 용도).
  const cancel = body?.cancel !== false

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan_status, plan_expires_at')
    .eq('id', user.id)
    .single()

  // 자동 갱신 중일 때만 의미가 있다. 1개월권·체험은 애초에 갱신되지 않는다.
  if (profile?.plan_status !== 'active') {
    return NextResponse.json({ error: 'not_active' }, { status: 400 })
  }

  const { error } = await serviceClient
    .from('profiles')
    .update({ cancel_at_period_end: cancel })
    .eq('id', user.id)

  if (error) {
    console.error('[billing/cancel] 상태 변경 실패:', user.id, error.message)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  console.log(`[billing/cancel] 자동 갱신 ${cancel ? '해지' : '재개'}:`, user.id)
  return NextResponse.json({
    ok: true,
    cancelAtPeriodEnd: cancel,
    // 화면이 "언제까지 쓸 수 있는지" 안내할 수 있게 남은 만료일을 돌려준다.
    planExpiresAt: profile?.plan_expires_at ?? null,
  })
}
