import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId, getYesterdayVideos } from '@/lib/youtube'
import { summarizeVideo, getTranscript } from '@/lib/gemini'
import { sendDigestEmail, sendBreakingAlert, sendAdminBulkErrorEmail, DigestTrigger } from '@/lib/mailer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

// Tier 1 유료 전환: 60초 timeout 안에 안전한 상한
const MAX_VIDEOS_PER_RUN = 20
// 한 묶음에 동시에 처리할 영상 수 (Tier 1 분당 150건 한도 내에서 안전)
const CONCURRENCY = 5

export async function POST(req: Request) {
  const startTime = Date.now()
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

    // 사용자 이메일 언어 (미설정 시 'ko')
    const userLocale: 'ko' | 'en' = settings.locale === 'en' ? 'en' : 'ko'

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

    // 1단계: 모든 채널의 영상을 수집 (중복/이미 처리된 영상 제외)
    type Channel = (typeof channels)[number]
    type Video = Awaited<ReturnType<typeof getYesterdayVideos>>[number]
    type VideoTask = { channel: Channel; video: Video }
    const videoTasks: VideoTask[] = []

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

      const videos = await getYesterdayVideos(channelId, userId)
      for (const video of videos) {
        if (processedVideoIds.has(video.videoId)) continue
        processedVideoIds.add(video.videoId)
        videoTasks.push({ channel, video })
        if (videoTasks.length >= MAX_VIDEOS_PER_RUN) break
      }
      if (videoTasks.length >= MAX_VIDEOS_PER_RUN) {
        console.log(`⚠️ 최대 처리 한도 ${MAX_VIDEOS_PER_RUN}개 도달, 나머지는 다음 실행으로 이월`)
        break
      }
    }

    console.log(`🎬 처리 대상 영상: ${videoTasks.length}개 (동시 처리: ${CONCURRENCY}개씩)`)

    // 단일 영상 처리 함수
    const processVideo = async (task: VideoTask) => {
      const vStart = Date.now()
      const { channel, video } = task
      const tStart = Date.now()
      const { transcript, description } = await getTranscript(video.videoId, userId)
      const tElapsed = Date.now() - tStart
      const sStart = Date.now()
      const summary = await summarizeVideo(userId, video.title, transcript, description)
      const sElapsed = Date.now() - sStart
      const isBreaking = keywords.some(kw => video.title.includes(kw))
      const categoryName = (channel as any).categories?.name ?? '미분류'

      const digestItem = {
        channel: channel.alias,
        category: categoryName,
        emoji: channel.emoji,
        video,
        summary,
        isBreaking,
      }

      const dbStart = Date.now()
      await supabase.from('digests').insert({
        user_id: userId,
        channel_alias: channel.alias,
        channel_emoji: channel.emoji,
        category_name: categoryName,
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
      const dbElapsed = Date.now() - dbStart

      let breakingElapsed = 0
      if (settings.breaking_alert && isBreaking) {
        const bStart = Date.now()
        await sendBreakingAlert(
          settings.email,
          profile?.name ?? '사용자',
          digestItem,
          userLocale
        )
        breakingElapsed = Date.now() - bStart
      }

      console.log(
        `🎞 [video ${video.videoId}] total=${Date.now() - vStart}ms ` +
          `transcript=${tElapsed}ms gemini=${sElapsed}ms db=${dbElapsed}ms` +
          (breakingElapsed ? ` breaking=${breakingElapsed}ms` : '')
      )

      return digestItem
    }

    // 2단계: CONCURRENCY 묶음으로 병렬 처리 (Promise.allSettled로 부분 실패 허용)
    for (let i = 0; i < videoTasks.length; i += CONCURRENCY) {
      const batch = videoTasks.slice(i, i + CONCURRENCY)
      const batchNum = Math.floor(i / CONCURRENCY) + 1
      const totalBatches = Math.ceil(videoTasks.length / CONCURRENCY)
      const batchStart = Date.now()
      console.log(`▶ 묶음 ${batchNum}/${totalBatches} 시작 (영상 ${batch.length}개)`)
      const batchResults = await Promise.allSettled(batch.map(processVideo))
      console.log(`◀ 묶음 ${batchNum}/${totalBatches} 완료 (${Date.now() - batchStart}ms)`)
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]
        const task = batch[j]
        if (result.status === 'fulfilled') {
          const item = result.value
          digestItems.push(item)
          if (item.summary.errorInfo) {
            failedItems.push({
              channel: item.channel,
              category: item.category,
              emoji: item.emoji,
              videoTitle: item.video.title,
              videoUrl: item.video.url,
              errorInfo: item.summary.errorInfo,
              attempts: item.summary.attempts,
            })
          }
        } else {
          console.error(`❌ 영상 처리 실패 (${task.video.videoId}):`, result.reason)
          failedItems.push({
            channel: task.channel.alias,
            category: (task.channel as any).categories?.name ?? '미분류',
            emoji: task.channel.emoji,
            videoTitle: task.video.title,
            videoUrl: task.video.url,
            errorInfo: result.reason instanceof Error ? result.reason.message : String(result.reason),
          })
        }
      }
    }

    // 다이제스트 이메일 발송
    if (digestItems.length > 0) {
      await sendDigestEmail(
        settings.email,
        profile?.name ?? '사용자',
        digestItems,
        userLocale
      )
    }

    // 오류 항목 번들 메일 발송 — 실패해도 디지스트 응답엔 영향 없게
    if (failedItems.length > 0) {
      console.log(`[digest] 관리자 오류 메일 발송 시도: userId=${userId}, failedCount=${failedItems.length}`)
      try {
        await sendAdminBulkErrorEmail(
          profile?.name ?? '사용자',
          settings.email,
          userId,
          failedItems,
          trigger
        )
        console.log(`[digest] 관리자 오류 메일 발송 완료: userId=${userId}`)
      } catch (adminMailError) {
        console.error(`[digest] 관리자 오류 메일 발송 실패: userId=${userId}`, adminMailError)
      }
    }

    // 30일 지난 기록 삭제
    await supabase.rpc('delete_old_digests')

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const successCount = digestItems.filter(i => !i.summary.errorInfo).length
    const failedCount = failedItems.length
    console.log(
      `📊 처리 완료: 성공 ${successCount}개, 실패 ${failedCount}개, 소요시간 ${elapsed}초 (userId=${userId})`
    )

    return NextResponse.json({
      success: true,
      sent: digestItems.length,
      succeeded: successCount,
      failed: failedCount,
      elapsedSeconds: Number(elapsed),
    })
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`❌ digest 서버 오류 (소요시간 ${elapsed}초):`, error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}