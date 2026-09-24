import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { archiveUserPayments } from '@/lib/payments-archive'

// 회원 탈퇴 — 계정과 개인 데이터를 삭제한다.
// ⚠️ 공유 풀 테이블(videos, video_summaries, channel_fetch_state)은 다른 사용자가
//    재사용하는 공유 데이터이므로 절대 삭제하지 않는다.
// ⚠️ 외래키가 profiles(id)를 참조하고 ON DELETE CASCADE가 없으므로
//    반드시 '자식 → 부모' 순서로 삭제해야 한다.
export async function POST() {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안에서 읽는다.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const cookieStore = await cookies()
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // 무시
        }
      },
    },
  })

  const { data: { user }, error: userError } = await authClient.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = user.id
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 탈퇴 회원의 공유 링크를 비공개로 돌린다(이용약관 제11조 4항) — 관리자 비공개 처리와 같은 blocked_at.
  // ★ 행은 지우지 않는다. share_reports가 참조할 수 있고 신고 기록은 1년 보관 의무가 있다.
  //   물리 삭제는 기존 만료 정리(cleanupExpiredShares)에 맡긴다.
  // ★ 실패하면 탈퇴를 중단한다. 아무것도 지우기 전이라 계정은 그대로 남고, 다시 시도할 수 있다.
  //   (계속 진행하면 약관과 달리 공유 링크가 공개된 채로 남는다)
  const { error: shareError } = await serviceClient
    .from('shared_summaries')
    .update({ blocked_at: new Date().toISOString() })
    .eq('shared_by', userId)
    .is('blocked_at', null)
  if (shareError) {
    console.error('[account/delete] 공유 비공개 처리 실패:', shareError.message)
    return NextResponse.json(
      { error: '계정 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }

  // 결제 기록을 계정과 분리해 보관 테이블로 옮긴다(개인정보처리방침 제3조 3항 — 결제일로부터 5년).
  // ★ 이관이 실패하면 탈퇴를 중단한다. 그대로 진행하면 auth 삭제 시 CASCADE로 결제 기록이
  //   보관 없이 사라져 법정 보존 의무를 어기게 된다.
  try {
    const archived = await archiveUserPayments(serviceClient, userId, user.email ?? null)
    console.log(`[account/delete] 결제 기록 이관: ${archived}건`)
  } catch (e) {
    console.error('[account/delete] 결제 기록 이관 실패:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: '계정 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }

  // 개인 데이터 삭제 — 자식 → 부모 순서.
  // 각 테이블은 user_id 컬럼 보유 확인됨(profiles만 PK가 id).
  // 삭제 실패는 로깅만 하고 계속 진행(마지막 profiles/auth 삭제 성공을 최종 기준으로 삼음).
  const childTables = [
    'send_log',     // (1) user_id
    'email_logs',   // (2) user_id
    'digests',      // (3) user_id
    'channels',     // (4) user_id
    'categories',   // (5) user_id
    'settings',     // (6) user_id
  ] as const
  // ※ 공유 풀(videos, video_summaries, channel_fetch_state)은 여기에 포함하지 않는다(삭제 금지).

  for (const table of childTables) {
    const { error } = await serviceClient.from(table).delete().eq('user_id', userId)
    if (error) {
      console.error(`[account/delete] ${table} 삭제 실패:`, error.message)
    }
  }

  // (7) profiles — PK가 id
  const { error: profileError } = await serviceClient
    .from('profiles')
    .delete()
    .eq('id', userId)
  if (profileError) {
    console.error('[account/delete] profiles 삭제 실패:', profileError.message)
  }

  // 마지막으로 계정 자체 삭제 (service key 필요 — 서버에서만 동작)
  const { error: authError } = await serviceClient.auth.admin.deleteUser(userId)
  if (authError) {
    console.error('[account/delete] auth 계정 삭제 실패:', authError.message)
    return NextResponse.json(
      { error: '계정 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
