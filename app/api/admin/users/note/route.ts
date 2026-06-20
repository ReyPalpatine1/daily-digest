import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { invalidateUsersCache } from '../route'

export async function POST(request: Request) {
  // === 관리자 권한 확인 ===
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안에서 읽는다. 최상단에서 읽으면 adminEmails가 빈 배열이 되어 403이 난다.
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
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

  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!adminEmails.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // === 입력 파싱 ===
  let body: { userId?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { userId } = body
  if (!userId) {
    return NextResponse.json({ error: 'userId가 필요합니다' }, { status: 400 })
  }
  // 빈 문자열/공백이면 메모 삭제(null) 처리
  const trimmed = (body.note ?? '').trim()
  const note = trimmed.length > 0 ? trimmed.slice(0, 500) : null

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const { error: updateError } = await serviceClient
    .from('profiles')
    .update({ admin_note: note })
    .eq('id', userId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // 메모 변경 즉시 통계에 반영되도록 users 캐시 무효화
  invalidateUsersCache()

  return NextResponse.json({ success: true, userId, note })
}
