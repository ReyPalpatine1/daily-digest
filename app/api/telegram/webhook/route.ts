import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

type TelegramUpdate = {
  message?: {
    chat: { id: number }
    text?: string
    from?: { first_name?: string }
  }
}

function decodeCode(code: string, secret: string): { userId: string; expired: boolean } | null {
  const parts = code.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts
  let payload: Buffer
  try {
    payload = Buffer.from(payloadB64, 'base64url')
  } catch {
    return null
  }
  if (payload.length !== 20) return null
  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 6)
  if (sig !== expectedSig) return null
  const uuidHex = payload.slice(0, 16).toString('hex')
  const userId = `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`
  const expiry = payload.readUInt32BE(16)
  const expired = Math.floor(Date.now() / 1000) > expiry
  return { userId, expired }
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch {
    // 발송 실패는 무시 — 연결은 이미 저장됨
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
  if (webhookSecret) {
    const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
    if (header !== webhookSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const linkSecret = process.env.TELEGRAM_LINK_SECRET ?? 'default-link-secret'
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

  let update: TelegramUpdate
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const message = update.message
  if (!message) return NextResponse.json({ ok: true })

  const chatId = message.chat.id
  const text = message.text ?? ''

  if (!text.startsWith('/start')) return NextResponse.json({ ok: true })

  const parts = text.split(' ')
  const code = parts[1]?.trim()

  if (!code) {
    if (botToken) {
      await sendTelegramMessage(botToken, chatId, '안녕하세요! Daily Digest 봇입니다.\n앱에서 연결 버튼을 누른 후 다시 시작해주세요.')
    }
    return NextResponse.json({ ok: true })
  }

  const decoded = decodeCode(code, linkSecret)

  if (!decoded) {
    if (botToken) {
      await sendTelegramMessage(botToken, chatId, '유효하지 않은 연결 코드입니다. 앱에서 다시 연결 버튼을 눌러주세요.')
    }
    return NextResponse.json({ ok: true })
  }

  if (decoded.expired) {
    if (botToken) {
      await sendTelegramMessage(botToken, chatId, '연결 코드가 만료되었습니다 (유효기간 10분). 앱에서 다시 연결 버튼을 눌러주세요.')
    }
    return NextResponse.json({ ok: true })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey)
  await serviceClient
    .from('settings')
    .update({ telegram_chat_id: chatId.toString() })
    .eq('user_id', decoded.userId)

  if (botToken) {
    const name = message.from?.first_name ?? '사용자'
    await sendTelegramMessage(
      botToken,
      chatId,
      `${name}님, Daily Digest 텔레그램 연결이 완료되었습니다!\n이제 이 채널로 다이제스트를 받아보실 수 있습니다. 🎉`,
    )
  }

  return NextResponse.json({ ok: true })
}
