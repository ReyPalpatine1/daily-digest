import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId, getYesterdayVideos } from '@/lib/youtube'
import { summarizeVideo, getTranscript } from '@/lib/gemini'
import { sendDigestEmail, sendBreakingAlert, sendAdminBulkErrorEmail, DigestTrigger } from '@/lib/mailer'
import { syncUserPlan } from '@/lib/plan-sync'

const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

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
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const userId: string = body.userId
  const trigger: DigestTrigger = body.trigger === 'cron' ? 'cron' : 'manual'
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  // 자동(cron) 호출은 즉시 202를 반환하고 무거운 처리는 after()로 백그라운드 실행한다.
  // → 호출자(/api/cron)가 digest 완료를 기다리며 자신의 60초(Hobby 상한)를 소진하는 문제를 방지.
  //   각 digest 인보케이션은 자기만의 60초 budget에서 메일까지 완료한다
  //   (수동 발송이 이미 60초 내 완료됨이 증명됨).
  if (trigger === 'cron') {
    after(async () => {
      try {
        const r = await runDigest(userId, trigger)
        console.log(`📨 [digest][bg] 완료 userId=${userId} status=${r.status} ${JSON.stringify(r.body)}`)
      } catch (e) {
        console.error(`❌ [digest][bg] 처리 실패 userId=${userId}:`, e)
      }
    })
    return NextResponse.json({ accepted: true, mode: 'background' }, { status: 202 })
  }

  // 수동 발송은 완료까지 기다렸다가 결과(처리 건수 등)를 반환 — UI가 사용.
  const { status, body: respBody } = await runDigest(userId, trigger)
  return NextResponse.json(respBody, { status })
}

async function runDigest(
  userId: string,
  trigger: DigestTrigger
): Promise<{ status: number; body: any }> {
  const startTime = Date.now()
  try {
    // 유저 설정 가져오기
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!settings?.active || !settings?.email) {
      return { status: 400, body: { error: '설정 없음' } }
    }

    // 사용자 이메일 언어 (미설정 시 'ko')
    const userLocale: 'ko' | 'en' = settings.locale === 'en' ? 'en' : 'ko'

    // 만료 체크 + 동기화 (접속 안 해도 여기서 만료 강등이 잡힘)
    const currentPlan = await syncUserPlan(userId)

    // 유저 프로필 가져오기
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    const isPro =
      currentPlan === 'pro' ||
      currentPlan === 'vip' ||
      (profile?.email && adminEmails.includes(String(profile.email).toLowerCase()))

    // 채널 목록 가져오기
    const { data: allChannels } = await supabase
      .from('channels')
      .select('*, categories(name, color)')
      .eq('user_id', userId)

    // Free는 활성 채널(오래된 5개)만 요약. Pro/VIP/관리자는 전체.
    const channels = isPro
      ? allChannels
      : (allChannels ?? []).filter(c => c.is_active !== false)

    if (!channels?.length) {
      return { status: 200, body: { message: '채널 없음' } }
    }

    const digestItems = []
    const failedItems = []
    const keywords: string[] = settings.breaking_keywords ?? ['속보']

    // 수동 발송("지금 실행하기")은 사용자가 일부러 누른 거니 중복 체크 스킵 — 항상 다시 처리/발송
    // 자동 발송(cron)은 같은 영상 중복 발송 방지를 위해 기존 처리분 제외
    const isManual = trigger === 'manual'
    let processedVideoIds = new Set<string>()
    if (!isManual) {
      const { data: existingDigests } = await supabase
        .from('digests')
        .select('video_id')
        .eq('user_id', userId)
      processedVideoIds = new Set((existingDigests ?? []).map(d => d.video_id))
    }

    // 1단계: 모든 채널의 영상을 수집
    type Channel = (typeof channels)[number]
    type Video = Awaited<ReturnType<typeof getYesterdayVideos>>[number]
    type VideoTask = { channel: Channel; video: Video }
    const videoTasks: VideoTask[] = []
    const seenInThisRun = new Set<string>() // 같은 채널/실행 내 중복 방지

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
        if (seenInThisRun.has(video.videoId)) continue
        // manual=true이면 processedVideoIds는 비어있으므로 항상 통과 (재처리)
        if (processedVideoIds.has(video.videoId)) continue
        seenInThisRun.add(video.videoId)
        videoTasks.push({ channel, video })
        if (videoTasks.length >= MAX_VIDEOS_PER_RUN) break
      }
      if (videoTasks.length >= MAX_VIDEOS_PER_RUN) {
        console.log(`⚠️ 최대 처리 한도 ${MAX_VIDEOS_PER_RUN}개 도달, 나머지는 다음 실행으로 이월`)
        break
      }
    }

    console.log(
      `🎬 ${isManual ? '수동' : '자동'} 발송: 처리 대상 영상 ${videoTasks.length}개 (동시 처리: ${CONCURRENCY}개씩)`
    )

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
      // (user_id, video_id) UNIQUE 위에서 upsert: 수동 재발송 시 행을 새로 만들지 않고
      // 기존 행의 요약/타임라인을 새 결과로 갱신. cron 재시도에도 안전한 멱등 처리.
      await supabase.from('digests').upsert(
        {
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
        },
        { onConflict: 'user_id,video_id' }
      )
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

    return {
      status: 200,
      body: {
        success: true,
        sent: digestItems.length,
        succeeded: successCount,
        processed: successCount, // 클라이언트 호환용 별칭
        failed: failedCount,
        total: videoTasks.length,
        elapsedSeconds: Number(elapsed),
      },
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`❌ digest 서버 오류 (소요시간 ${elapsed}초):`, error)
    return { status: 500, body: { error: '서버 오류' } }
  }
}