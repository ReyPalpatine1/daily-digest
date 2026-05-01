import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

export async function GET(req: Request) {
  const authClient = createRouteHandlerClient({ cookies })
  const { data: { user }, error: userError } = await authClient.auth.getUser()

  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!adminEmails.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const { data, error } = await serviceClient
    .from('api_usage')
    .select('user_id, date, api_calls, tokens_used')
    .order('date', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const totalCalls = (data ?? []).reduce((sum: number, item: any) => sum + (item.api_calls ?? 0), 0)
  const totalTokens = (data ?? []).reduce((sum: number, item: any) => sum + (item.tokens_used ?? 0), 0)

  return NextResponse.json({ totalCalls, totalTokens, rows: data ?? [] })
}
