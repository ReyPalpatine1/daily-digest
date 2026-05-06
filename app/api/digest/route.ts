import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId, getYesterdayVideos } from '@/lib/youtube'
import { summarizeVideo, getTranscript } from '@/lib/gemini'
import { sendDigestEmail, sendBreakingAlert, sendAdminBulkErrorEmail, DigestTrigger } from '@/lib/mailer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const userId: string = body.userId
    const trigger: DigestTrigger = body.trigger === 'cron' ? 'cron' : 'manual'

    // 유저 설정 가져오기
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!settings?.active || !settings?.email) {
      return NextResponse.json({ error: '설정 없음' }, { status: 400 })
    }

    // 유저 프로필 가져오기
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    // 채널 목록 가져오기
    const { data: channels } = await supabase
      .from('channels')
      .select('*, categories(name, color)')
      .eq('user_id', userId)

    if (!channels?.length) {
      return NextResponse.json({ message: '채널 없음' })
    }

    const digestItems = []
    const failedItems = []
    const keywords: string[] = settings.breaking_keywords ?? ['속보']

    // 이미 처리된 영상 ID 미리 조회 (cron 재시도 시 중복 발송 방지)
    const { data: existingDigests } = await supabase
      .from('digests')
      .select('video_id')
      .eq('user_id', userId)
    const processedVideoIds = new Set((existingDigests ?? []).map(d => d.video_id))

    for (const channel of channels) {
      // 채널 ID 추출
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

      // 전날 영상 가져오기
      const videos = await getYesterdayVideos(channelId, userId)

      for (const video of videos) {
        // 이미 처리된 영상이면 스킵 (idempotent)
        if (processedVideoIds.has(video.videoId)) continue
        processedVideoIds.add(video.videoId)

        // API 한도 방지를 위한 딜레이
        await new Promise(r => setTimeout(r, 1500))

        // 자막 + 설명 추출
        const { transcript, description } = await getTranscript(video.videoId, userId)

        // Gemini로 요약
        const summary = await summarizeVideo(userId, video.title, transcript, description)

        // 속보 감지
        const isBreaking = keywords.some(kw => video.title.includes(kw))

        const digestItem = {
          channel: channel.alias,
          category: (channel as any).categories?.name ?? '미분류',
          emoji: channel.emoji,
          video,
          summary,
          isBreaking,
        }

        digestItems.push(digestItem)

        // Supabase에 저장
        await supabase.from('digests').insert({
          user_id: userId,
          channel_alias: channel.alias,
          channel_emoji: channel.emoji,
          category_name: (channel as any).categories?.name ?? '미분류',
          video_id: video.videoId,
          video_title: video.title,
          video_url: video.url,
          published_at: video.publishedAt,
          summary: summary.summary,
          key_points: summary.keyPoints,
          timeline: summary.timeline,
          is_breaking: isBreaking,
          is_read: false,
          summary_basis: summary.summaryBasis,
        })

        // 오류난 항목 수집
        if (summary.errorInfo) {
          failedItems.push({
            channel: channel.alias,
            category: (channel as any).categories?.name ?? '미분류',
            emoji: channel.emoji,
            videoTitle: video.title,
            videoUrl: video.url,
            errorInfo: summary.errorInfo,
            attempts: summary.attempts,
          })
        }

        // 속보 즉시 발송
        if (settings.breaking_alert && isBreaking) {
          await sendBreakingAlert(
            settings.email,
            profile?.name ?? '사용자',
            digestItem
          )
        }
      }
    }

    // 다이제스트 이메일 발송
    if (digestItems.length > 0) {
      await sendDigestEmail(
        settings.email,
        profile?.name ?? '사용자',
        digestItems
      )
    }

    // 오류 항목 번들 메일 발송
    if (failedItems.length > 0) {
      await sendAdminBulkErrorEmail(
        profile?.name ?? '사용자',
        settings.email,
        userId,
        failedItems,
        trigger
      )
    }

    // 30일 지난 기록 삭제
    await supabase.rpc('delete_old_digests')

    return NextResponse.json({
      success: true,
      sent: digestItems.length,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}