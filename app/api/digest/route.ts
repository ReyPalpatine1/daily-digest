import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId } from '@/lib/youtube'
import { yesterdayRangeUtc, formatDateKst } from '@/lib/time'
import { sendAdminBulkErrorEmail, DigestTrigger } from '@/lib/mailer'
import { deliverDigest, deliverBreaking, deliverEmptyDigest } from '@/lib/delivery'
import { syncUserPlan } from '@/lib/plan-sync'
import { markScheduledSent, markScheduledFailed, logManualSend, tryStartBreaking, markBreakingSent, markBreakingFailed } from '@/lib/send-guard'
import { getVideosFromPool, getSummariesFromPool, summarizeNow, matchesKeyword, MAX_SUMMARY_ATTEMPTS } from '@/lib/video-pool'
import { et, type EmailLocale } from '@/lib/i18n/email-translations'

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

// 한 번 발송에서 처리할 영상 상한 (60초 budget 보호)
const MAX_VIDEOS_PER_RUN = 20

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
  // Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
  // adminEmails는 요청 처리 시점(이 함수 내부)에서 계산한다.
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
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

    // 사용자 이메일 언어 (미설정/미지원 값은 'ko' 폴백)
    const userLocale: EmailLocale =
      settings.locale === 'en' || settings.locale === 'zh' || settings.locale === 'ja'
        ? settings.locale
        : 'ko'

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
      // 보낼 채널이 없어도 정각 발송은 "오늘 처리함"으로 마감 (재시도 루프 방지)
      if (trigger === 'cron') await markScheduledSent(userId)
      return { status: 200, body: { message: '채널 없음' } }
    }

    const userName = profile?.name ?? '사용자'
    const isManual = trigger === 'manual'
    // 수동 발송은 통계용으로만 기록 (멱등성과 무관, best-effort)
    if (isManual) void logManualSend(userId)

    // 사용자 속보 키워드 (사용자별 판정용)
    const keywords: string[] = settings.breaking_keywords ?? []

    // 채널 메타 맵 (channel_id → alias/emoji/category). channel_id 없으면 1회 보정.
    const channelMeta = new Map<string, { alias: string; emoji: string; category: string }>()
    for (const ch of channels) {
      let channelId = ch.channel_id
      if (!channelId) {
        channelId = await getChannelId(ch.url, userId)
        if (channelId) {
          await supabase.from('channels').update({ channel_id: channelId }).eq('id', ch.id)
        }
      }
      if (!channelId) continue
      if (!channelMeta.has(channelId)) {
        channelMeta.set(channelId, {
          alias: ch.alias,
          emoji: ch.emoji,
          category: (ch as any).categories?.name ?? '미분류',
        })
      }
    }
    const channelIds = [...channelMeta.keys()]

    // 어제 범위 (KST) — 진단 로그
    const { start, end } = yesterdayRangeUtc('Asia/Seoul')
    console.log(`📅 어제범위 UTC: ${start.toISOString()} ~ ${end.toISOString()}`)
    console.log(`📅 KST환산: ${formatDateKst(start)} ~ ${formatDateKst(end)}`)

    // 공유 풀에서 어제 영상 조회 (쇼츠 제외) → 상한 컷
    const poolVideos = (await getVideosFromPool(channelIds, start, end)).slice(0, MAX_VIDEOS_PER_RUN)
    const rawVideoCount = poolVideos.length
    const videoIds = poolVideos.map(v => v.video_id)

    // 요약 조인 (공유 캐시, 사용자 언어 기준)
    let summaries = await getSummariesFromPool(videoIds, userLocale)

    // 폴백 C: 요약 없는 영상 즉시 요약 후 재조회 (누락 0 보장)
    const missingIds = videoIds.filter(id => !summaries.has(id))
    let summarizedNow = 0
    if (missingIds.length > 0) {
      console.log(`⚡ 즉시 요약 필요(폴백 C): ${missingIds.length}개`)
      summarizedNow = await summarizeNow(missingIds, userLocale)
      summaries = await getSummariesFromPool(videoIds, userLocale)
    }
    console.log(
      `📊 풀 영상 ${rawVideoCount}개 | 캐시히트 ${rawVideoCount - missingIds.length}개 | 즉시요약 ${summarizedNow}개 (${isManual ? '수동' : '자동'})`
    )

    // 영상 0개 처리
    if (rawVideoCount === 0) {
      if (trigger === 'cron' && settings.notify_when_empty !== false) {
        try {
          await deliverEmptyDigest(settings, userName, userLocale, userId)
        } catch (e) {
          console.error(`[digest] 빈 다이제스트 메일 발송 실패 userId=${userId}:`, e)
        }
      }
      if (trigger === 'cron') await markScheduledSent(userId)
      const message = userLocale === 'en'
        ? 'No new videos were uploaded yesterday.'
        : '어제 올라온 새 영상이 없어요.'
      return {
        status: 200,
        body: { success: true, sent: 0, succeeded: 0, processed: 0, failed: 0, total: 0, empty: true, message },
      }
    }

    // 실패 사유 코드 → 이메일 문구 번역 키
    const failTextKeys: Record<string, string> = {
      no_source: 'digest.failNoSource',
      temporary: 'digest.failTemporary',
      pending: 'digest.failPending',
      live: 'digest.failLive',
    }

    // 다이제스트 아이템 구성 (공유 요약 + 사용자별 속보 판정)
    const digestItems = []
    const failedItems = []
    for (const v of poolVideos) {
      const meta = channelMeta.get(v.channel_id) ?? { alias: '채널', emoji: '📺', category: '미분류' }
      const s = summaries.get(v.video_id)
      const isBreaking = matchesKeyword(v.title, keywords)
      const url = `https://youtube.com/watch?v=${v.video_id}`
      // 요약 없음 → 사유 판정: 라이브 > 풀에 기록된 사유 > (상한 도달=temporary / 미도달=pending)
      let failReason: string | null = null
      if (!s) {
        const isLive = v.live_broadcast_content === 'live' || v.live_broadcast_content === 'upcoming'
        failReason = isLive
          ? 'live'
          : (v.fail_reason ?? ((v.summary_attempts ?? 0) >= MAX_SUMMARY_ATTEMPTS ? 'temporary' : 'pending'))
      }
      const item = {
        channel: meta.alias,
        category: meta.category,
        emoji: meta.emoji,
        video: {
          videoId: v.video_id,
          title: v.title,
          publishedAt: v.published_at,
          channelTitle: meta.alias,
          url,
        },
        summary: {
          // 요약 없음: 사유별 구분 문구 (텔레그램 등 요약 텍스트를 그대로 쓰는 채널 호환)
          summary: s?.summary ?? et(userLocale, failTextKeys[failReason!] ?? 'digest.summaryUnavailable'),
          // 풀(JSONB)에서 온 값이 배열이 아닐 수 있음 → 이후 .map() TypeError 방지
          keyPoints: Array.isArray(s?.key_points) ? s.key_points : [],
          timeline: Array.isArray(s?.timeline) ? s.timeline : [],
          summaryBasis: s?.summary_basis ?? '요약',
          failReason: failReason ?? undefined,
          failDetail: !s ? (v.fail_detail ?? undefined) : undefined,
        },
        isBreaking,
      }
      digestItems.push(item)
      if (!s) {
        failedItems.push({
          channel: meta.alias,
          category: meta.category,
          emoji: meta.emoji,
          videoTitle: v.title,
          videoUrl: url,
          errorInfo: '요약 없음 (풀 미스 + 즉시요약 실패)',
        })
      }
    }

    // 다이제스트 이메일 발송
    if (digestItems.length > 0) {
      await deliverDigest(settings, userName, digestItems, userLocale, userId, isPro)
    }

    // 속보 표시 영상은 속보 메일도 (Pro & breaking_alert 켜짐) — 사용자별 키워드 기준.
    // breaking 라우트와 (user_id, video_id) 멱등성을 공유해 중복 발송 방지.
    if (settings.breaking_alert && isPro) {
      for (const item of digestItems) {
        if (!item.isBreaking) continue
        const canSend = await tryStartBreaking(userId, item.video.videoId)
        if (!canSend) continue
        try {
          await deliverBreaking(settings, userName, item, userLocale, userId, isPro)
          await markBreakingSent(userId, item.video.videoId)
        } catch (e) {
          await markBreakingFailed(userId, item.video.videoId, String(e))
          console.error(`[digest] 속보 메일 실패 (${item.video.videoId}):`, e)
        }
      }
    }

    // 히스토리/읽음 표시용 digests 사용자별 기록 (upsert, 멱등)
    for (const item of digestItems) {
      // 한 항목의 예외(데이터 이상 등)가 루프 전체와 이후 로직(delete_old_digests 등)을
      // 중단시키지 않도록 항목 단위로 격리.
      try {
        // digests.key_points는 text[] 컬럼인데 공유 풀(video_summaries.key_points)은 JSONB라
        // 객체 요소가 섞일 수 있다 → 모든 요소를 문자열로 정규화 (insert 실패 방지).
        const keyPoints = (Array.isArray(item.summary.keyPoints) ? item.summary.keyPoints : []).map((p: any) =>
          typeof p === 'string' ? p : (p?.point ?? p?.text ?? JSON.stringify(p))
        )
        const { error } = await supabase.from('digests').upsert(
          {
            user_id: userId,
            channel_alias: item.channel,
            channel_emoji: item.emoji,
            category_name: item.category,
            video_id: item.video.videoId,
            video_title: item.video.title,
            video_url: item.video.url,
            published_at: item.video.publishedAt,
            summary: item.summary.summary,
            key_points: keyPoints,
            timeline: item.summary.timeline,
            is_breaking: item.isBreaking,
            is_read: false,
            summary_basis: item.summary.summaryBasis,
            // 요약 성공 시 null (upsert가 이전 실패 기록도 정리), 실패·라이브·대기 시 사유 기록
            fail_reason: item.summary.failReason ?? null,
            fail_detail: item.summary.failDetail ?? null,
          },
          { onConflict: 'user_id,video_id' }
        )
        if (error) {
          console.error(`[digest] digests upsert 실패 (${item.video.videoId}): ${error.message}`)
        }
      } catch (e) {
        console.error(`[digest] digests 기록 예외 (${item.video.videoId}):`, e)
      }
    }

    // 오류 항목 번들 메일 (요약 누락 등) — 실패해도 응답엔 영향 없게
    if (failedItems.length > 0) {
      console.log(`[digest] 관리자 오류 메일 발송 시도: userId=${userId}, failedCount=${failedItems.length}`)
      try {
        await sendAdminBulkErrorEmail(userName, settings.email, userId, failedItems, trigger)
      } catch (adminMailError) {
        console.error(`[digest] 관리자 오류 메일 발송 실패: userId=${userId}`, adminMailError)
      }
    }

    // 30일 지난 기록 삭제
    await supabase.rpc('delete_old_digests')

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const successCount = digestItems.length - failedItems.length
    console.log(
      `📊 처리 완료(공유풀): 성공 ${successCount}개, 실패 ${failedItems.length}개, 소요 ${elapsed}초 (userId=${userId})`
    )

    // 정각 발송 완료 기록 (멱등성: 같은 날 재실행 방지)
    if (trigger === 'cron') await markScheduledSent(userId)

    return {
      status: 200,
      body: {
        success: true,
        sent: digestItems.length,
        succeeded: successCount,
        processed: successCount, // 클라이언트 호환용 별칭
        failed: failedItems.length,
        total: rawVideoCount,
        cacheHits: rawVideoCount - missingIds.length,
        summarizedNow,
        elapsedSeconds: Number(elapsed),
      },
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`❌ digest 서버 오류 (소요시간 ${elapsed}초):`, error)
    // 정각 발송 실패 기록 → 다음 cron 슬롯에서 재시도됨
    if (trigger === 'cron') {
      try { await markScheduledFailed(userId, String(error)) } catch { /* 기록 실패는 무시 */ }
    }
    return { status: 500, body: { error: '서버 오류' } }
  }
}