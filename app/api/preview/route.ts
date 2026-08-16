import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId } from '@/lib/youtube'
import { logErrorEvent } from '@/lib/error-log'
import { deliverDigest } from '@/lib/delivery'
import { syncUserPlan } from '@/lib/plan-sync'
import {
  collectChannelsNow,
  getSummariesFromPool,
  summarizeNow,
  matchesKeyword,
  MAX_SUMMARY_ATTEMPTS,
  type UniqueChannel,
  type PoolVideo,
} from '@/lib/video-pool'
import { isDescriptionBasedSummary, isTranscriptFailedSummary } from '@/lib/summary-basis'
import { et, type EmailLocale } from '@/lib/i18n/email-translations'
import { failReasonTranslationKeys } from '@/lib/email-templates'
import { getAuthedUser, isAdminEmail } from '@/lib/route-auth'

// 가입 직후 "미리보기" — 구독 채널의 최신 영상 3개를 지금 요약해 열람 기록에만 저장한다.
// 메일 발송·send_log·속보 발송은 일절 하지 않는다(정기 발송 경로와 완전 분리).
// 계정당 1회(profiles.preview_used_at)이며, 이미 정기 발송을 받은 계정(first_digest_at)은 대상 아님.

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워진다. 최상단에서 createClient를 호출하면 키가 undefined가 되어
// "supabaseKey is required"로 터지므로, 첫 사용 시점에 1회 lazy 생성한다. (digest 라우트와 동일)
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

// 즉시 수집에 쓸 시간 budget (ms). 남은 시간은 요약(가장 오래 걸림)에 넘긴다.
const COLLECT_BUDGET_MS = 20_000
// 미리보기로 요약할 영상 수
const PREVIEW_VIDEO_LIMIT = 3

// 실패 사유 → 요약 자리에 넣을 문구(라벨+설명). 묶음은 email-templates의
// failReasonTranslationKeys 하나만 쓴다 — 채널마다 매핑이 갈리지 않도록 (digest 라우트와 동일).
function failText(locale: EmailLocale, failReason: string | null): string | null {
  const keys = failReasonTranslationKeys(failReason ?? undefined)
  if (!keys) return null
  return `${et(locale, keys.labelKey)}\n${et(locale, keys.noteKey)}`
}

export async function POST() {
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 선점(preview_used_at) 되돌리기 — 요약 0건·예외 시 사용자가 기회를 잃지 않도록.
  const releaseClaim = async () => {
    try {
      await supabase.from('profiles').update({ preview_used_at: null }).eq('id', user.id)
    } catch (e) {
      console.error('[preview] 선점 해제 실패:', e)
    }
  }

  try {
    // 1) 자격 확인 — 이미 정기 발송을 받은 계정은 미리보기 대상이 아니다.
    const { data: profile } = await supabase
      .from('profiles')
      .select('preview_used_at, first_digest_at, email, name')
      .eq('id', user.id)
      .single()

    if (profile?.first_digest_at) {
      return NextResponse.json({ error: 'not_eligible' }, { status: 409 })
    }

    // 2) 원샷 선점 — 동시/반복 클릭은 여기서 걸러진다(조건부 UPDATE의 반환 행 수로 판정).
    const { data: claimed } = await supabase
      .from('profiles')
      .update({ preview_used_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('preview_used_at', null)
      .select('id')

    if (!claimed?.length) {
      return NextResponse.json({ error: 'already_used' }, { status: 409 })
    }

    // 3) 설정 — 요약 언어 (미설정/미지원 값은 'ko' 폴백, digest 라우트와 동일)
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    const userLocale: EmailLocale =
      settings?.locale === 'en' || settings?.locale === 'zh' || settings?.locale === 'ja'
        ? settings.locale
        : 'ko'

    const userName = profile?.name ?? '사용자'

    // 4) 플랜 판정 (digest 라우트와 동일 — 만료 동기화 + 관리자 예외)
    const currentPlan = await syncUserPlan(user.id)
    const isPro =
      currentPlan === 'pro' ||
      currentPlan === 'vip' ||
      isAdminEmail(profile?.email ?? user.email)

    // 5) 채널 목록 — Free는 활성 채널만, Pro/VIP/관리자는 전체
    const { data: allChannels } = await supabase
      .from('channels')
      .select('*, categories(name, color)')
      .eq('user_id', user.id)

    const channels = isPro
      ? (allChannels ?? [])
      : (allChannels ?? []).filter(c => c.is_active !== false)

    if (!channels.length) {
      await releaseClaim()
      return NextResponse.json({ error: 'no_channels' }, { status: 400 })
    }

    // 채널 메타 맵 (channel_id → alias/emoji/category). channel_id 없으면 1회 보정.
    const channelMeta = new Map<string, { alias: string; emoji: string; category: string }>()
    const collectTargets: UniqueChannel[] = []
    for (const ch of channels) {
      let channelId = ch.channel_id
      if (!channelId) {
        channelId = await getChannelId(ch.url, user.id)
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
        collectTargets.push({
          channelId,
          uploadsPlaylistId: (ch as any).uploads_playlist_id ?? null,
        })
      }
    }
    const channelIds = [...channelMeta.keys()]

    if (!channelIds.length) {
      await releaseClaim()
      return NextResponse.json({ error: 'no_channels' }, { status: 400 })
    }

    // 6) 즉시 수집 — 신규 계정은 공유 풀에 이 채널 영상이 아직 없을 수 있다.
    const collectResult = await collectChannelsNow(collectTargets, Date.now() + COLLECT_BUDGET_MS)
    console.log(
      `📡 [preview] 즉시 수집 user=${user.id} 채널 ${collectResult.processed}/${collectTargets.length} 신규 ${collectResult.collected} timedOut=${collectResult.timedOut}`
    )

    // 7) 요약 대상 — 최신 3개 (날짜 범위 조건 없음: 최근 업로드가 없어도 미리보기는 채운다)
    const { data: videoRows } = await supabase
      .from('videos')
      .select('video_id, channel_id, title, published_at, duration_seconds, is_short, description, summary_attempts, live_broadcast_content, fail_reason, fail_detail')
      .in('channel_id', channelIds)
      .eq('is_short', false)
      .lt('summary_attempts', MAX_SUMMARY_ATTEMPTS)
      // 라이브/예정 제외. NOT IN은 컬럼이 NULL이면 결과가 NULL이라 그 행까지 탈락시키므로
      // (수집 시 details 조회 실패분·과거 행은 NULL) is.null 분기를 함께 둔다 → 미리보기가 비지 않게.
      .or('live_broadcast_content.is.null,and(live_broadcast_content.neq.live,live_broadcast_content.neq.upcoming)')
      .order('published_at', { ascending: false })
      .limit(PREVIEW_VIDEO_LIMIT)

    const videos = (videoRows ?? []) as PoolVideo[]
    if (!videos.length) {
      await releaseClaim()
      return NextResponse.json({ empty: true, reason: 'no_videos' })
    }

    // 8) 요약 — 공유 풀 캐시 우선, 없는 것만 즉시 요약 후 재조회
    const videoIds = videos.map(v => v.video_id)
    let summaries = await getSummariesFromPool(videoIds, userLocale)
    const missingIds = videoIds.filter(id => !summaries.has(id))
    if (missingIds.length > 0) {
      const summarizedNow = await summarizeNow(missingIds, userLocale)
      console.log(`⚡ [preview] 즉시 요약 ${summarizedNow}/${missingIds.length}개 user=${user.id}`)
      summaries = await getSummariesFromPool(videoIds, userLocale)
    }

    if (summaries.size === 0) {
      // 한 건도 요약되지 않았으면 미리보기로서 의미가 없다 → 기회를 돌려준다.
      await releaseClaim()
      return NextResponse.json({ empty: true, reason: 'no_summaries' })
    }

    // 9) 항목 구성 — digest 라우트와 동일(메일 본문과 열람 기록이 실제 발송과 일치하도록).
    const keywords: string[] = settings?.breaking_keywords ?? []
    const previewItems = videos.map(v => {
      const meta = channelMeta.get(v.channel_id) ?? { alias: '채널', emoji: '📺', category: '미분류' }
      const s = summaries.get(v.video_id)
      let failReason: string | null = null
      if (!s) {
        failReason = v.fail_reason ?? ((v.summary_attempts ?? 0) >= MAX_SUMMARY_ATTEMPTS ? 'temporary' : 'pending')
      } else if (!isPro && isTranscriptFailedSummary(s.summary_basis)) {
        // 자막 확보 실패(우리 쪽 사정) — 숨김은 pro_only와 같되 사유만 정직하게 표기 (digest 라우트와 동일).
        failReason = 'transcript_failed'
      } else if (!isPro && isDescriptionBasedSummary(s.summary_basis)) {
        // 자막 없는 영상(설명 기반 요약)은 Pro 전용 — 무료 사용자에겐 안내 문구만.
        failReason = 'pro_only'
      }
      // pro_only / transcript_failed: 요약은 풀에 존재하지만 본문·포인트·타임라인을 메일/digests에 노출하지 않음
      const withheld = failReason === 'pro_only' || failReason === 'transcript_failed'
      return {
        channel: meta.alias,
        category: meta.category,
        emoji: meta.emoji,
        video: {
          videoId: v.video_id,
          title: v.title,
          publishedAt: v.published_at,
          channelTitle: meta.alias,
          url: `https://youtube.com/watch?v=${v.video_id}`,
        },
        summary: {
          tldr: (!withheld && typeof s?.tldr === 'string') ? s.tldr : undefined,
          summary: (withheld ? null : s?.summary) ?? failText(userLocale, failReason) ?? et(userLocale, 'digest.summaryUnavailable'),
          keyPoints: !withheld && Array.isArray(s?.key_points) ? s.key_points : [],
          timeline: !withheld && Array.isArray(s?.timeline) ? s.timeline : [],
          summaryBasis: s?.summary_basis ?? '요약',
          failReason: failReason ?? undefined,
          failDetail: !s ? (v.fail_detail ?? undefined) : undefined,
        },
        isBreaking: matchesKeyword(v.title, keywords),
      }
    })

    // 10) 열람 기록(digests) 저장 (upsert, 멱등)
    let saved = 0
    for (const item of previewItems) {
      try {
        // digests.key_points는 text[] 컬럼인데 공유 풀(video_summaries.key_points)은 JSONB라
        // 객체 요소가 섞일 수 있다 → 모든 요소를 문자열로 정규화 (insert 실패 방지).
        const keyPoints = (Array.isArray(item.summary.keyPoints) ? item.summary.keyPoints : []).map((p: any) =>
          typeof p === 'string' ? p : (p?.point ?? p?.text ?? JSON.stringify(p))
        )
        const { error } = await supabase.from('digests').upsert(
          {
            user_id: user.id,
            channel_alias: item.channel,
            channel_emoji: item.emoji,
            category_name: item.category,
            video_id: item.video.videoId,
            video_title: item.video.title,
            video_url: item.video.url,
            published_at: item.video.publishedAt,
            summary: item.summary.summary,
            tldr: item.summary.tldr ?? null,
            key_points: keyPoints,
            timeline: item.summary.timeline,
            is_breaking: item.isBreaking,
            is_read: false,
            summary_basis: item.summary.summaryBasis,
            fail_reason: item.summary.failReason ?? null,
            fail_detail: item.summary.failDetail ?? null,
          },
          { onConflict: 'user_id,video_id' }
        )
        if (error) {
          console.error(`[preview] digests upsert 실패 (${item.video.videoId}): ${error.message}`)
        } else {
          saved++
        }
      } catch (e) {
        console.error(`[preview] digests 기록 예외 (${item.video.videoId}):`, e)
      }
    }

    // 11) 실제 발송 — 사용자가 받게 될 다이제스트와 동일한 메일/텔레그램(채널 분기는 deliverDigest가 담당).
    //     email_logs에는 'preview'로 기록되어 정기 발송 중복 판정(hasDigestSentToday)과 섞이지 않는다.
    //     발송 실패는 열람 기록 저장을 되돌리지 않으며 선점도 유지한다(로그만 남기고 정상 응답).
    let mailed = false
    try {
      await deliverDigest(settings, userName, previewItems, userLocale, user.id, isPro, 'preview')
      mailed = true
    } catch (e) {
      console.error(`[preview] 미리보기 발송 실패 (userId=${user.id}):`, e)
      await logErrorEvent({
        source: 'preview',
        failReason: 'send_error',
        failDetail: `미리보기 발송 실패 (userId=${user.id}): ${String(e)}`,
      })
    }

    console.log(`✅ [preview] 완료 user=${user.id} saved=${saved}/${videos.length} mailed=${mailed}`)
    return NextResponse.json({ success: true, saved, mailed })
  } catch (error) {
    console.error('❌ [preview] 처리 실패:', error)
    await releaseClaim()
    await logErrorEvent({
      source: 'preview',
      failReason: 'preview_error',
      failDetail: `미리보기 처리 실패 (userId=${user.id}): ${String(error)}`,
    })
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
