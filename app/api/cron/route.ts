import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: Request) {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)

    const formatted = Object.fromEntries(
      parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
    ) as Record<string, string>
    const currentSendTime = `${formatted.hour.padStart(2, '0')}:${formatted.minute.padStart(2, '0')}`

    // 현재 KST 기준에 맞춰 발송 대상 유저만 가져오기
    const { data: settings, error } = await supabase
      .from('settings')
      .select('user_id')
      .eq('active', true)
      .eq('send_time', currentSendTime)

    if (error) {
      console.error('Settings fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!settings?.length) {
      console.log(`현재 KST ${currentSendTime}에 발송할 활성 유저 없음`)
      return NextResponse.json({ message: '발송 대상 없음', currentSendTime })
    }

    console.log(`현재 KST ${currentSendTime} 발송 대상 ${settings.length}명 발견`)

    // 각 유저별 다이제스트 실행
    const results = await Promise.allSettled(
      settings.map(s =>
        fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/digest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: s.user_id }),
        }).then(res => res.json())
      )
    )

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`성공: ${succeeded}, 실패: ${failed}`)

    return NextResponse.json({ currentSendTime, succeeded, failed })
  } catch (error) {
    console.error('Cron error:', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}