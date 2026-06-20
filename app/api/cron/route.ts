import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { nowUtc, toZoned, dateKey, isSendTimePassed, isTooLateToSend } from '@/lib/time'
import { tryStartScheduled } from '@/lib/send-guard'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워진다. 최상단에서 createClient를 호출하면 키가 undefined가 되어
// "supabaseKey is required"로 터지므로, 첫 사용 시점에 1회 lazy 생성한다. (Vercel도 동일 동작)
function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
}
type ServiceClient = ReturnType<typeof makeServiceClient>
let _supabase: ServiceClient | null = null
function getSupabase(): ServiceClient {
  if (!_supabase) _supabase = makeServiceClient()
  return _supabase
}
const supabase: ServiceClient = new Proxy({} as ServiceClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export const maxDuration = 60

// 발송시간 경과 후 이 시간(시)을 넘기면 오늘은 발송하지 않는다 (아침분이 저녁에 가는 것 방지).
// cron이 1~5시간 밀려도 발송되도록 충분히 크게, 단 "엉뚱한 시간대 발송"은 막을 만큼 작게.
const MAX_LATE_HOURS = 6

export async function GET(req: Request) {
  try {
    // === 진단 1: cron route 진입 자체 확인 (인증 전) ===
    console.log(`🕐 [cron] 실행됨 (진입): ${new Date().toISOString()}`)
    console.log(`🕐 [cron] KST: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`)
    console.log(`🔧 [cron] NEXT_PUBLIC_APP_URL=${JSON.stringify(process.env.NEXT_PUBLIC_APP_URL)}`)

    // === 진단 2: 인증 ===
    const authHeader = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET}`
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      // 조용히 401만 반환하지 말고 원인 로그를 남긴다 (시크릿 불일치 진단)
      console.warn(
        `🚫 [cron] 인증 실패 → 401. ` +
          `CRON_SECRET 설정됨=${Boolean(process.env.CRON_SECRET)}, ` +
          `헤더 수신=${Boolean(authHeader)}, ` +
          `일치=${authHeader === expected}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log(`✅ [cron] 인증 통과`)

    const now = nowUtc()
    const todayKstDate = dateKey(now)                        // KST "YYYY-MM-DD"
    const zoned = toZoned(now)                               // 로그/표시용 KST 시:분
    const currentHour = String(zoned.hour).padStart(2, '0')
    const currentMinute = String(zoned.minute).padStart(2, '0')

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

    const digestUsers: string[] = []
    const skipReasons: Record<string, string> = {}

    for (const s of allSettings) {
      const sendTime = (s.send_time ?? '').trim()
      if (!/^\d{2}:\d{2}$/.test(sendTime)) {
        skipReasons[s.user_id] = `invalid send_time=${JSON.stringify(s.send_time)}`
        continue
      }

      // 1) 좁은 슬롯 매칭 대신 "발송시간 경과 + 멱등성"으로 판정.
      //    GitHub Actions cron이 밀려 15분 슬롯을 놓쳐도, 그날 처음 도는 cron에서 발송된다.
      if (!isSendTimePassed(sendTime, 'Asia/Seoul', now)) {
        skipReasons[s.user_id] = `not yet (now ${currentHour}:${currentMinute}, send ${sendTime})`
        continue
      }
      // 너무 늦은 발송 방지: 발송시간 + MAX_LATE_HOURS 초과면 오늘은 skip → 다음날 정상 발송.
      if (isTooLateToSend(sendTime, MAX_LATE_HOURS * 60, 'Asia/Seoul', now)) {
        skipReasons[s.user_id] = `too late (now ${currentHour}:${currentMinute}, send ${sendTime}, >${MAX_LATE_HOURS}h)`
        continue
      }

      // 2) 발송 시작 시도 — send_log 멱등성 + 동시성 방어 (이미 보냈거나 처리 중이면 false)
      //    하루 1회 보장은 여기서 담당 → cron이 11:06이든 11:40이든 그날 한 번만 발송.
      const canSend = await tryStartScheduled(s.user_id)
      console.log(`정각발송 user=${s.user_id} send_time=${sendTime} 경과=true canSend=${canSend}`)
      if (!canSend) {
        skipReasons[s.user_id] = 'already sent/sending today (send_log)'
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

    // === 진단: 발송 대상이 있는데 APP_URL이 비어있으면 fetch가 전부 실패한다 ===
    // 끝의 슬래시를 제거해 '//api/...' 중복 슬래시 방지
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
    if (digestUsers.length > 0 && !appUrl) {
      console.error(
        `❌ [cron] NEXT_PUBLIC_APP_URL 미설정 → /api/digest 호출 불가. ` +
          `발송 대상 ${digestUsers.length}명이 있으나 전부 실패합니다. ` +
          `환경변수에 NEXT_PUBLIC_APP_URL을 설정하세요.`
      )
    }

    const digestResults = digestUsers.length > 0
      ? await Promise.allSettled(
          digestUsers.map(async userId => {
            const target = `${appUrl}/api/digest`
            try {
              const res = await fetch(target, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, trigger: 'cron' }),
              })
              const text = await res.text()
              console.log(
                `📧 [cron] digest 호출 user=${userId} url=${target} status=${res.status} body=${text.slice(0, 300)}`
              )
              if (!res.ok) {
                throw new Error(`/api/digest ${res.status}: ${text.slice(0, 200)}`)
              }
              try { return JSON.parse(text) } catch { return { raw: text } }
            } catch (err) {
              console.error(`❌ [cron] digest 호출 실패 user=${userId} url=${target}:`, err)
              throw err
            }
          })
        )
      : []

    const breakingResults = breakingUsers.length > 0
      ? await Promise.allSettled(
          breakingUsers.map(userId =>
            // background:true → /api/breaking이 즉시 202 후 백그라운드 처리 (cron 60초 미점유)
            fetch(`${appUrl}/api/breaking`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, background: true }),
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
    // 실패한 호출의 사유를 명시적으로 노출 (원인 진단용)
    for (const r of digestResults) {
      if (r.status === 'rejected') console.error(`❌ [cron] digest rejected:`, r.reason)
    }
    for (const r of breakingResults) {
      if (r.status === 'rejected') console.error(`❌ [cron] breaking rejected:`, r.reason)
    }

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
