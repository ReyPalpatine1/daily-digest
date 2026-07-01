import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

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
