import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId, getRecentVideos } from '@/lib/youtube'
import { getTranscript, summarizeVideo } from '@/lib/gemini'
import { sendBreakingAlert, sendAdminBulkErrorEmail } from '@/lib/mailer'
import { syncUserPlan } from '@/lib/plan-sync'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

export const maxDuration = 60

type RecentVideoItem = {
  videoId: string
  title: string
  publishedAt: string
  channelTitle: string
  url: string
  channel: {
    alias: string
    emoji: string
    categoryName?: string
    channel_id?: string
  }
}

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

    // 사용자 이메일 언어 (미설정 시 'ko')
    const userLocale: 'ko' | 'en' = settings.locale === 'en' ? 'en' : 'ko'

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

    const keywords = ((settings.breaking_keywords as string[]) ?? ['속보'])
      .map((kw: string) => kw.toLowerCase().trim())
      .filter(Boolean)

    const recentVideos: RecentVideoItem[] = []

    for (const channel of channels) {
      let channelId = channel.channel_id
      if (!channelId) {
        channelId = await getChannelId(channel.url, userId)
        if (channelId) {
          await supabase
            .from('channels')
            .update({ channel_id: channelId })
            .eq('id', channel.id)
        }
      }
      if (!channelId) continue

      const videos = await getRecentVideos(channelId, 15, userId)
      recentVideos.push(
        ...videos.map(video => ({
          ...video,
          channel: {
            alias: channel.alias,
            emoji: channel.emoji,
            categoryName: (channel as any).category_name ?? '미분류',
            channel_id: channelId,
          },
        }))
      )
    }

    if (!recentVideos.length) {
      return { status: 200, body: { message: '최근 영상 없음' } }
    }

    const breakingVideos = recentVideos.filter(video =>
      keywords.some(kw => video.title.toLowerCase().includes(kw))
    )

    if (!breakingVideos.length) {
      return { status: 200, body: { message: '속보 영상 없음' } }
    }

    const { data: existingDigests, error: existingError } = await supabase
      .from('digests')
      .select('video_id')
      .in('video_id', breakingVideos.map(video => video.videoId))

    if (existingError) {
      console.error('Existing digests fetch error:', existingError)
      return { status: 500, body: { error: existingError.message } }
    }

    const existingIds = new Set((existingDigests ?? []).map((item: any) => item.video_id))
    const newVideos = breakingVideos.filter(video => !existingIds.has(video.videoId))

    if (!newVideos.length) {
      return { status: 200, body: { message: '새로운 속보 없음', skipped: breakingVideos.length } }
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
    for (const video of newVideos) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      const { transcript, description } = await getTranscript(video.videoId, userId)
      const summary = await summarizeVideo(userId, video.title, transcript, description)

      const digestItem = {
        channel: video.channel.alias,
        category: video.channel.categoryName ?? '미분류',
        emoji: video.channel.emoji,
        video,
        summary,
        isBreaking: true,
      }

      await sendBreakingAlert(settings.email, profile?.name ?? '사용자', digestItem, userLocale, userId)

      if (summary.errorInfo) {
        failedItems.push({
          channel: video.channel.alias,
          category: video.channel.categoryName ?? '미분류',
          emoji: video.channel.emoji,
          videoTitle: video.title,
          videoUrl: video.url,
          errorInfo: summary.errorInfo,
          attempts: summary.attempts,
        })
      }

      await supabase.from('digests').insert({
        user_id: userId,
        channel_alias: video.channel.alias,
        channel_emoji: video.channel.emoji,
        category_name: video.channel.categoryName ?? '미분류',
        video_id: video.videoId,
        video_title: video.title,
        video_url: video.url,
        published_at: video.publishedAt,
        summary: summary.summary,
        key_points: summary.keyPoints,
        timeline: summary.timeline,
        is_breaking: true,
        is_read: false,
        summary_basis: summary.summaryBasis,
      })

      sentCount += 1
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
        console.log(`[breaking] 관리자 오류 메일 발송 완료: userId=${userId}`)
      } catch (adminMailError) {
        console.error(`[breaking] 관리자 오류 메일 발송 실패: userId=${userId}`, adminMailError)
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        sentCount,
        totalBreaking: breakingVideos.length,
        skipped: breakingVideos.length - sentCount,
      },
    }
  } catch (error) {
    console.error('Breaking route error:', error)
    return { status: 500, body: { error: '서버 오류' } }
  }
}
