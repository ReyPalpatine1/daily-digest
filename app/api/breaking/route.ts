import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId, getRecentVideos } from '@/lib/youtube'
import { getTranscript, summarizeVideo } from '@/lib/gemini'
import { sendBreakingAlert, sendAdminBulkErrorEmail } from '@/lib/mailer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

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
  try {
    const { userId } = await req.json()
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('breaking_alert, breaking_keywords, email')
      .eq('user_id', userId)
      .single()

    if (settingsError) {
      console.error('Settings fetch error:', settingsError)
      return NextResponse.json({ error: settingsError.message }, { status: 500 })
    }

    if (!settings?.breaking_alert || !settings?.email) {
      return NextResponse.json({ message: 'breaking alert not enabled or email missing' })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    const { data: channels, error: channelsError } = await supabase
      .from('channels')
      .select('*')
      .eq('user_id', userId)

    if (channelsError) {
      console.error('Channels fetch error:', channelsError)
      return NextResponse.json({ error: channelsError.message }, { status: 500 })
    }

    if (!channels?.length) {
      return NextResponse.json({ message: '채널 없음' })
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
      return NextResponse.json({ message: '최근 영상 없음' })
    }

    const breakingVideos = recentVideos.filter(video =>
      keywords.some(kw => video.title.toLowerCase().includes(kw))
    )

    if (!breakingVideos.length) {
      return NextResponse.json({ message: '속보 영상 없음' })
    }

    const { data: existingDigests, error: existingError } = await supabase
      .from('digests')
      .select('video_id')
      .in('video_id', breakingVideos.map(video => video.videoId))

    if (existingError) {
      console.error('Existing digests fetch error:', existingError)
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const existingIds = new Set((existingDigests ?? []).map((item: any) => item.video_id))
    const newVideos = breakingVideos.filter(video => !existingIds.has(video.videoId))

    if (!newVideos.length) {
      return NextResponse.json({ message: '새로운 속보 없음', skipped: breakingVideos.length })
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

      await sendBreakingAlert(settings.email, profile?.name ?? '사용자', digestItem)

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
      await sendAdminBulkErrorEmail(
        profile?.name ?? '사용자',
        settings.email,
        userId,
        failedItems,
        'breaking'
      )
    }

    return NextResponse.json({
      success: true,
      sentCount,
      totalBreaking: breakingVideos.length,
      skipped: breakingVideos.length - sentCount,
    })
  } catch (error) {
    console.error('Breaking route error:', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
