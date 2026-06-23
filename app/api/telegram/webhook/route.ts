import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendTelegramMessage } from '@/lib/telegram'

// 텔레그램 webhook — 봇이 받은 업데이트를 텔레그램이 이 라우트로 POST 한다.
// 사용자가 딥링크로 /start {코드} 를 보내면 코드를 매칭해 telegram_chat_id 를 자동 저장.
//
// 텔레그램은 200이 아니면 같은 업데이트를 계속 재시도하므로, 처리 실패라도 200을 반환하고
// 내부 로깅만 한다(단, secret 불일치는 401로 막는다).

// process.env / createClient 는 모두 핸들러 내부에서(Cloudflare 호환).
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
}

// 봇 답장 — 실패해도 흐름(200 반환)을 막지 않는다.
async function reply(chatId: number | string, text: string): Promise<void> {
  try {
    await sendTelegramMessage(String(chatId), text)
  } catch (e) {
    console.error('[telegram/webhook] 답장 실패:', e)
  }
}

export async function POST(request: Request) {
  // === 보안: 텔레그램 secret token 검증 ===
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  const gotSecret = request.headers.get('x-telegram-bot-api-secret-token')
  if (!expectedSecret || gotSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let update: any
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ ok: true }) // 파싱 실패도 200(재시도 방지)
  }

  const message = update?.message
  const chatId: number | string | undefined = message?.chat?.id
  const text: string = typeof message?.text === 'string' ? message.text : ''

  // 채팅 정보가 없으면 처리할 게 없음
  if (chatId === undefined) {
    return NextResponse.json({ ok: true })
  }

  // '/start {코드}' 파싱 — 코드가 없는 /start 나 기타 메시지는 간단 안내
  const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?/)
  const code = match?.[1]

  if (!code) {
    await reply(chatId, '연결하려면 Daily Digest 앱의 텔레그램 연결 버튼에서 받은 링크로 다시 시작해 주세요.')
    return NextResponse.json({ ok: true })
  }

  try {
    const supabase = getServiceClient()

    const { data: linkRow } = await supabase
      .from('telegram_link_codes')
      .select('code, user_id, expires_at, used')
      .eq('code', code)
      .maybeSingle()

    const isValid =
      linkRow &&
      linkRow.used === false &&
      new Date(linkRow.expires_at) > new Date()

    if (!isValid) {
      await reply(chatId, '연결 코드가 만료되었거나 유효하지 않습니다. 앱에서 다시 시도해 주세요.')
      return NextResponse.json({ ok: true })
    }

    // 해당 사용자에 chat_id 저장 + 발송 채널을 telegram 으로 전환
    const { error: updateError } = await supabase
      .from('settings')
      .update({ telegram_chat_id: String(chatId), delivery_method: 'telegram' })
      .eq('user_id', linkRow.user_id)

    if (updateError) {
      console.error('[telegram/webhook] settings 업데이트 실패:', updateError)
      await reply(chatId, '연결 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
      return NextResponse.json({ ok: true })
    }

    // 코드 사용 처리
    await supabase
      .from('telegram_link_codes')
      .update({ used: true })
      .eq('code', code)

    await reply(chatId, '✅ 연결 완료! 이제 Daily Digest를 텔레그램으로 받아보실 수 있어요.')
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[telegram/webhook] 처리 오류:', e)
    return NextResponse.json({ ok: true }) // 실패해도 200(텔레그램 재시도 방지)
  }
}
