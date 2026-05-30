import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET}`
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)

    const kst = Object.fromEntries(
      parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
    ) as Record<string, string>

    const todayKstDate = `${kst.year}-${kst.month}-${kst.day}`
    const todayKstStartIso = new Date(`${todayKstDate}T00:00:00+09:00`).toISOString()
    const currentHour = kst.hour.padStart(2, '0')
    const currentMinute = kst.minute.padStart(2, '0')
    const currentMinutesTotal = Number(currentHour) * 60 + Number(currentMinute)

    const { data: allSettings, error } = await supabase
      .from('settings')
      .select('user_id, send_time, breaking_alert')
      .eq('active', true)

    if (error) {
      console.error('[cron] settings fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!allSettings?.length) {
      console.log(`[cron] KST ${todayKstDate} ${currentHour}:${currentMinute} - 활성 유저 없음`)
      return NextResponse.json({ message: '활성 유저 없음' })
    }

    const userIds = allSettings.map(s => s.user_id)
    const { data: todayDigests } = await supabase
      .from('digests')
      .select('user_id, is_breaking')
      .in('user_id', userIds)
      .gte('created_at', todayKstStartIso)

    const sentDigestUserIds = new Set(
      (todayDigests ?? []).filter(d => !d.is_breaking).map(d => d.user_id)
    )

    const digestUsers: string[] = []
    const skipReasons: Record<string, string> = {}

    for (const s of allSettings) {
      const sendTime = (s.send_time ?? '').trim()
      if (!/^\d{2}:\d{2}$/.test(sendTime)) {
        skipReasons[s.user_id] = `invalid send_time=${JSON.stringify(s.send_time)}`
        continue
      }
      const [sendH, sendM] = sendTime.split(':').map(Number)
      const sendMinutes = sendH * 60 + sendM

      if (currentMinutesTotal < sendMinutes) {
        skipReasons[s.user_id] = `not yet (now ${currentHour}:${currentMinute} < ${sendTime})`
        continue
      }
      if (sentDigestUserIds.has(s.user_id)) {
        skipReasons[s.user_id] = 'already sent today'
        continue
      }
      digestUsers.push(s.user_id)
    }

    const breakingUsers = allSettings
      .filter(s => s.breaking_alert)
      .map(s => s.user_id)

    console.log(
      `[cron] KST ${todayKstDate} ${currentHour}:${currentMinute} | active=${allSettings.length} digest=${digestUsers.length} breaking=${breakingUsers.length}`
    )
    for (const s of allSettings) {
      const status = digestUsers.includes(s.user_id)
        ? '→ DIGEST'
        : `(skip: ${skipReasons[s.user_id] ?? 'unknown'})`
      console.log(`  user=${s.user_id} send_time=${s.send_time} ${status}`)
    }

    const digestResults = digestUsers.length > 0
      ? await Promise.allSettled(
          digestUsers.map(userId =>
            fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/digest`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, trigger: 'cron' }),
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

    console.log(
      `[cron] digest 성공:${digestSucceeded} 실패:${digestFailed}, breaking 성공:${breakingSucceeded} 실패:${breakingFailed}`
    )

    return NextResponse.json({
      kst: `${todayKstDate} ${currentHour}:${currentMinute}`,
      activeUsers: allSettings.length,
      digest: { count: digestUsers.length, succeeded: digestSucceeded, failed: digestFailed },
      breaking: { count: breakingUsers.length, succeeded: breakingSucceeded, failed: breakingFailed },
    })
  } catch (error) {
    console.error('[cron] error:', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
