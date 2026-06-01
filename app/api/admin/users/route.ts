import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

export async function GET() {
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

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // created_at 컬럼이 없을 수 있어 방어적으로 조회
  let rows: any[] = []
  const res = await serviceClient
    .from('profiles')
    .select('id, email, name, plan, plan_expires_at, vip_granted_by, vip_granted_at, created_at')
    .order('created_at', { ascending: false })
  if (res.error) {
    const fallback = await serviceClient
      .from('profiles')
      .select('id, email, name, plan, plan_expires_at, vip_granted_by, vip_granted_at')
    rows = fallback.data ?? []
  } else {
    rows = res.data ?? []
  }

  const users = rows.map(p => ({
    id: p.id,
    email: p.email ?? '-',
    name: p.name ?? null,
    plan: (p.plan as 'free' | 'pro' | 'vip') ?? 'free',
    planExpiresAt: p.plan_expires_at ?? null,
    vipGrantedBy: p.vip_granted_by ?? null,
    vipGrantedAt: p.vip_granted_at ?? null,
    joinedAt: p.created_at ?? null,
  }))

  const counts = {
    total: users.length,
    free: users.filter(u => u.plan === 'free').length,
    pro: users.filter(u => u.plan === 'pro').length,
    vip: users.filter(u => u.plan === 'vip').length,
  }

  return NextResponse.json({ users, counts })
}
