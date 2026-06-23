import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createHmac } from 'crypto'

// Compact signed code: 16-byte UUID + 4-byte expiry (uint32 BE, seconds) → base64url(20 bytes) + '.' + 6-char sig
// Total ~34 chars, well within Telegram's 64-char start parameter limit.
function buildCode(userId: string, secret: string): string {
  const uuidHex = userId.replace(/-/g, '')
  const uuidBuf = Buffer.from(uuidHex, 'hex')
  const expiry = Math.floor(Date.now() / 1000) + 10 * 60
  const expiryBuf = Buffer.allocUnsafe(4)
  expiryBuf.writeUInt32BE(expiry, 0)
  const payload = Buffer.concat([uuidBuf, expiryBuf])
  const payloadB64 = payload.toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 6)
  return `${payloadB64}.${sig}`
}

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {}
      },
    },
  })

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const secret = process.env.TELEGRAM_LINK_SECRET ?? 'default-link-secret'
  // NEXT_PUBLIC 우선, 없으면 일반 변수. @ 기호·공백 제거(둘 중 뭐가 등록됐든 동작).
  const botUsername = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? process.env.TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '')

  // 봇 username 미설정 시 잘못된 폴백('YourBotHere')으로 엉뚱한 채널 연결되는 사고 방지 →
  // 명확히 500으로 실패.
  if (!botUsername) {
    console.error('[telegram/link-code] TELEGRAM_BOT_USERNAME 미설정')
    return NextResponse.json({ error: 'Telegram bot is not configured' }, { status: 500 })
  }

  const code = buildCode(user.id, secret)
  const deepLink = `https://t.me/${botUsername}?start=${code}`

  return NextResponse.json({ code, deepLink })
}
