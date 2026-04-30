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
    const currentHour = formatted.hour.padStart(2, '0')
    const currentMinute = Number(formatted.minute)
    const currentSendTime = `${currentHour}:00`
    const shouldSendDigest = currentMinute < 15

    const { data: allSettings, error } = await supabase
      .from('settings')
      .select('user_id, send_time, breaking_alert')
      .eq('active', true)

    if (error) {
      console.error('Settings fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!allSettings?.length) {
      console.log('활성 유저 없음')
      return NextResponse.json({ message: '활성 유저 없음' })
    }

    const digestUsers = shouldSendDigest
      ? allSettings.filter(s => s.send_time === currentSendTime).map(s => s.user_id)
      : []
    const breakingUsers = allSettings
      .filter(s => s.breaking_alert)
      .map(s => s.user_id)

    console.log(`현재 KST ${currentHour}:${formatted.minute} 실행 - digest 대상 ${digestUsers.length}명, breaking 대상 ${breakingUsers.length}명`)

    const digestResults = shouldSendDigest && digestUsers.length > 0
      ? await Promise.allSettled(
          digestUsers.map(userId =>
            fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/digest`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId }),
            }).then(res => res.json())
          )
        )
      : []

    const breakingResults = breakingUsers.length > 0
      ? await Promise.allSettled(
          breakingUsers.map(userId =>
            fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/breaking`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId }),
            }).then(res => res.json())
          )
        )
      : []

    const digestSucceeded = digestResults.filter(r => r.status === 'fulfilled').length
    const digestFailed = digestResults.filter(r => r.status === 'rejected').length
    const breakingSucceeded = breakingResults.filter(r => r.status === 'fulfilled').length
    const breakingFailed = breakingResults.filter(r => r.status === 'rejected').length

    console.log(`digest 성공: ${digestSucceeded}, 실패: ${digestFailed}`)
    console.log(`breaking 성공: ${breakingSucceeded}, 실패: ${breakingFailed}`)

    return NextResponse.json({
      currentHour,
      currentMinute,
      currentSendTime,
      shouldSendDigest,
      digest: { count: digestUsers.length, succeeded: digestSucceeded, failed: digestFailed },
      breaking: { count: breakingUsers.length, succeeded: breakingSucceeded, failed: breakingFailed },
    })
  } catch (error) {
    console.error('Cron error:', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}