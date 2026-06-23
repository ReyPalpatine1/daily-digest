import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 텔레그램 연결 코드 발급.
// 로그인 사용자가 호출 → 짧은 코드 발급 → 딥링크로 봇에 /start {코드} 전송하면
// webhook이 코드를 매칭해 그 사용자의 telegram_chat_id를 자동 저장한다.

// 혼동되는 문자(O/0, I/1 등) 제외한 8자리 코드.
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

export async function POST() {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // env는 핸들러 안에서 읽는다.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? ''

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

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  // 기존 미사용 코드 정리(중복 발급 방지) 후 새 코드 발급
  await serviceClient
    .from('telegram_link_codes')
    .delete()
    .eq('user_id', user.id)
    .eq('used', false)

  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10분

  const { error: insertError } = await serviceClient
    .from('telegram_link_codes')
    .insert({ code, user_id: user.id, expires_at: expiresAt, used: false })

  if (insertError) {
    console.error('[telegram/link-code] 코드 발급 실패:', insertError)
    return NextResponse.json({ error: '연결 코드 발급에 실패했습니다.' }, { status: 500 })
  }

  const deepLink = `https://t.me/${botUsername}?start=${code}`
  return NextResponse.json({ code, deepLink })
}
