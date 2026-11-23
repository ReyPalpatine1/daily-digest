import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { deleteUserAccount } from '@/lib/account-delete'

// 동의 팝업의 "동의하지 않고 나가기" → 방금 가입한 신규 계정만 삭제한다.
// 신규 판정: profiles.terms_agreed_at과 welcome_sent_at이 둘 다 비어 있을 때만.
//   (기존 회원은 sql/consent.sql에서 welcome_sent_at이 채워졌고, 운영자 SQL로 동의 처리도 되어 있다)
// 그 밖(프로필 없음 포함)은 403 not_new_account — 이 경로로는 기존 회원 계정을 절대 지우지 않는다.
// 일반 탈퇴는 /api/account/delete(프로필 화면 전용)를 쓴다.
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('terms_agreed_at, welcome_sent_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) {
    // 조회 실패를 "신규"로 보지 않는다(삭제 쪽으로 넘어가는 구멍 방지).
    console.error('[consent/decline] 프로필 조회 실패:', user.id, profileError.message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  if (!profile || profile.terms_agreed_at || profile.welcome_sent_at) {
    console.warn('[consent/decline] 신규 계정 아님 — 삭제 거부:', user.id)
    return NextResponse.json({ error: 'not_new_account' }, { status: 403 })
  }

  if (!(await deleteUserAccount(serviceClient, user.id, user.email ?? null, 'consent/decline'))) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  console.log('[consent/decline] 신규 가입 취소 완료:', user.id)
  return NextResponse.json({ success: true })
}
