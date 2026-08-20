import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'

// 등록된 카드 표시명 조회 — 본인 것만.
// ★ billing_key는 절대 응답에 담지 않는다. 화면에 필요한 건 표시명뿐이다.

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
