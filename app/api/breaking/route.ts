import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId } from '@/lib/youtube'
import { sendBreakingAlert, sendAdminBulkErrorEmail } from '@/lib/mailer'
import { syncUserPlan } from '@/lib/plan-sync'
import { getRecentPoolVideos, getSummary, summarizeNow, matchesKeyword } from '@/lib/video-pool'
import { tryStartBreaking, markBreakingSent, markBreakingFailed } from '@/lib/send-guard'
import { nowUtc, startOfDayUtc } from '@/lib/time'

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

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const userId: string = body.userId
  const background = body.background === true
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  // 자동(cron) 호출은 즉시 202를 반환하고 무거운 처리는 after()로 백그라운드 실행.
  // → 호출자(/api/cron)가 자신의 60초(Hobby 상한)를 잠식하지 않게 함.
  if (background) {
    after(async () => {
      try {
        const r = await runBreaking(userId)
        console.log(`📨 [breaking][bg] 완료 userId=${userId} status=${r.status} ${JSON.stringify(r.body)}`)
      } catch (e) {
        console.error(`❌ [breaking][bg] 처리 실패 userId=${userId}:`, e)
      }
    })
    return NextResponse.json({ accepted: true, mode: 'background' }, { status: 202 })
  }

  const { status, body: respBody } = await runBreaking(userId)
  return NextResponse.json(respBody, { status })
}

async function runBreaking(userId: string): Promise<{ status: number; body: any }> {
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // adminEmails는 요청 처리 시점(이 함수 내부)에서 계산한다.
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  try {
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (settingsError) {
      console.error('Settings fetch error:', settingsError)
      return { status: 500, body: { error: settingsError.message } }
    }

    if (!settings?.breaking_alert || !settings?.email) {
      return { status: 200, body: { message: 'breaking alert not enabled or email missing' } }
    }

    // 사용자 이메일 언어 (미설정 시 'ko'). 정규화(ko/en/zh/ja)는 mailer가 담당.
    const userLocale: string = settings.locale ?? 'ko'

    // 만료 체크 + 동기화
    const currentPlan = await syncUserPlan(userId)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', userId)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return { status: 500, body: { error: profileError.message } }
    }

    const isPro =
      currentPlan === 'pro' ||
      currentPlan === 'vip' ||
      (profile?.email && adminEmails.includes(String(profile.email).toLowerCase()))

    const { data: allChannels, error: channelsError } = await supabase
      .from('channels')
      .select('*')
      .eq('user_id', userId)

    if (channelsError) {
      console.error('Channels fetch error:', channelsError)
      return { status: 500, body: { error: channelsError.message } }
    }

    // Free는 활성 채널만 속보 감시. Pro/VIP/관리자는 전체.
    const channels = isPro
      ? allChannels
      : (allChannels ?? []).filter(c => c.is_active !== false)

    if (!channels?.length) {
      return { status: 200, body: { message: '채널 없음' } }
    }

    const keywords = ((settings.breaking_keywords as string[]) ?? [])
      .map((kw: string) => kw.trim())
      .filter(Boolean)
    if (!keywords.length) {
      return { status: 200, body: { message: '속보 키워드 없음' } }
    }

    // 채널 메타 + channel_id 보정 (channel_id → alias/emoji/category)
    const channelMeta = new Map<string, { alias: string; emoji: string; category: string }>()
    for (const channel of channels) {
      let channelId = channel.channel_id
      if (!channelId) {
        channelId = await getChannelId(channel.url, userId)
        if (channelId) {
          await supabase.from('channels').update({ channel_id: channelId }).eq('id', channel.id)
        }
      }
      if (!channelId) continue
      if (!channelMeta.has(channelId)) {
        channelMeta.set(channelId, {
          alias: channel.alias,
          emoji: channel.emoji,
          category: (channel as any).category_name ?? '미분류',
        })
      }
    }
    const channelIds = [...channelMeta.keys()]
    if (!channelIds.length) {
      return { status: 200, body: { message: '채널 없음(channel_id)' } }
    }

    // 감지 윈도우: 당일(KST) 전체 + 자정 직후엔 전날 막판 6시간도 보강 (놓친 속보 방지)
    const todayStart = startOfDayUtc('Asia/Seoul')
    const sixHoursAgo = new Date(nowUtc().getTime() - 6 * 3600_000)
    const since = todayStart < sixHoursAgo ? todayStart : sixHoursAgo

    // 공유 풀에서 최근 영상 → 사용자 키워드 매칭 (공유 풀엔 is_breaking 없음)
    const recent = await getRecentPoolVideos(channelIds, since)
    const matched = recent.filter(v => matchesKeyword(v.title, keywords))
    if (!matched.length) {
      return { status: 200, body: { message: '속보 영상 없음' } }
    }

    const failedItems: {
      channel: string
      category: string
      emoji: string
      videoTitle: string
      videoUrl: string
      errorInfo: string
      attempts?: number
    }[] = []

    let sentCount = 0
    let skipped = 0
    for (const video of matched) {
      // 속보 멱등성 (user_id, video_id) — 이미 보냈거나 처리 중이면 skip
      const canSend = await tryStartBreaking(userId, video.video_id)
      if (!canSend) { skipped++; continue }

      const meta = channelMeta.get(video.channel_id) ?? { alias: '채널', emoji: '📺', category: '미분류' }
      const url = `https://youtube.com/watch?v=${video.video_id}`
      try {
        // 요약 (공유 풀, 없으면 폴백 C: 즉시 요약)
        let s = await getSummary(video.video_id)
        if (!s) {
          await summarizeNow([video.video_id])
          s = await getSummary(video.video_id)
        }

        const digestItem = {
          channel: meta.alias,
          category: meta.category,
          emoji: meta.emoji,
          video: { videoId: video.video_id, title: video.title, publishedAt: video.published_at, channelTitle: meta.alias, url },
          summary: {
            summary: s?.summary ?? '요약을 준비 중이에요.',
            // 풀(JSONB)에서 온 값이 배열이 아닐 수 있음 → 이후 .map() TypeError 방지
            keyPoints: Array.isArray(s?.key_points) ? s.key_points : [],
            timeline: Array.isArray(s?.timeline) ? s.timeline : [],
            summaryBasis: s?.summary_basis ?? '요약',
          },
          isBreaking: true,
        }

        await sendBreakingAlert(settings.email, profile?.name ?? '사용자', digestItem, userLocale, userId)

        if (!s) {
          failedItems.push({
            channel: meta.alias, category: meta.category, emoji: meta.emoji,
            videoTitle: video.title, videoUrl: url, errorInfo: '요약 없음 (즉시요약 실패)',
          })
        }

        // 히스토리/읽음 표시용 digests 기록 (멱등 upsert)
        await supabase.from('digests').upsert(
          {
            user_id: userId,
            channel_alias: meta.alias,
            channel_emoji: meta.emoji,
            category_name: meta.category,
            video_id: video.video_id,
            video_title: video.title,
            video_url: url,
            published_at: video.published_at,
            summary: digestItem.summary.summary,
            key_points: digestItem.summary.keyPoints,
            timeline: digestItem.summary.timeline,
            is_breaking: true,
            is_read: false,
            summary_basis: digestItem.summary.summaryBasis,
          },
          { onConflict: 'user_id,video_id' }
        )

        await markBreakingSent(userId, video.video_id)
        sentCount += 1
      } catch (e) {
        await markBreakingFailed(userId, video.video_id, String(e))
        console.error(`[breaking] 발송 실패 user=${userId} video=${video.video_id}:`, e)
      }
    }

    if (failedItems.length > 0) {
      console.log(`[breaking] 관리자 오류 메일 발송 시도: userId=${userId}, failedCount=${failedItems.length}`)
      try {
        await sendAdminBulkErrorEmail(
          profile?.name ?? '사용자',
          settings.email,
          userId,
          failedItems,
          'breaking'
        )
      } catch (adminMailError) {
        console.error(`[breaking] 관리자 오류 메일 발송 실패: userId=${userId}`, adminMailError)
      }
    }

    return {
      status: 200,
      body: { success: true, sentCount, matched: matched.length, skipped },
    }
  } catch (error) {
    console.error('Breaking route error:', error)
    return { status: 500, body: { error: '서버 오류' } }
  }
}
