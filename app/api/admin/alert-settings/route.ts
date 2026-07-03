import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { findAdminTelegramChatId } from '@/lib/admin-alert'

// 관리자 오류 알림 설정 (admin_alert_settings 단일 행) 조회/저장.

// 관리자 권한 확인 — 기존 admin 라우트(users/set-plan)와 동일 패턴.
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
// env는 핸들러 안에서 읽는다.
async function requireAdmin(): Promise<
  | { ok: true; serviceClient: SupabaseClient }
  | { ok: false; response: NextResponse }
> {
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
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!adminEmails.includes(user.email.toLowerCase())) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, serviceClient: createClient(supabaseUrl, supabaseServiceRoleKey) }
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // 행이 없으면 기본값 (email on / telegram off) — 발송 로직(getAdminAlertSettings)과 동일
  const { data } = await auth.serviceClient
    .from('admin_alert_settings')
    .select('notify_email, notify_telegram')
    .maybeSingle()

  const telegramChatId = await findAdminTelegramChatId()
  return NextResponse.json({
    notify_email: (data as any)?.notify_email !== false,
    notify_telegram: (data as any)?.notify_telegram === true,
    telegramLinked: Boolean(telegramChatId),
  })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { notify_email?: boolean; notify_telegram?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (typeof body.notify_email !== 'boolean' || typeof body.notify_telegram !== 'boolean') {
    return NextResponse.json({ error: 'notify_email/notify_telegram(boolean)이 필요합니다' }, { status: 400 })
  }

  // 단일 행(id=true) upsert — 행이 아직 없어도 생성됨
  const { error } = await auth.serviceClient
    .from('admin_alert_settings')
    .upsert(
      { id: true, notify_email: body.notify_email, notify_telegram: body.notify_telegram },
      { onConflict: 'id' }
    )
  if (error) {
    console.error('[admin/alert-settings] 저장 실패:', error.message)
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
