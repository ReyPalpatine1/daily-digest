import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getChannelId } from '@/lib/youtube'
import { yesterdayRangeUtc, formatDateKst } from '@/lib/time'
import { DigestTrigger } from '@/lib/mailer'
import { sendAdminFailureAlert } from '@/lib/admin-alert'
import { logErrorEvent, cleanupOldErrorLogs } from '@/lib/error-log'
import { cleanupExpiredShares } from '@/lib/share'
import { deliverDigest, deliverBreaking, deliverEmptyDigest } from '@/lib/delivery'
import { syncUserPlan } from '@/lib/plan-sync'
import { markScheduledSent, markScheduledFailed, logManualSend, tryStartBreaking, markBreakingSent, markBreakingFailed, hasDigestSentToday } from '@/lib/send-guard'
import { getVideosFromPool, getSummariesFromPool, summarizeNow, matchesKeyword, MAX_SUMMARY_ATTEMPTS, SUMMARY_LOOKBACK_DAYS } from '@/lib/video-pool'
import { isDescriptionBasedSummary, isTranscriptFailedSummary } from '@/lib/summary-basis'
import { et, type EmailLocale } from '@/lib/i18n/email-translations'
import { failReasonTranslationKeys } from '@/lib/email-templates'
import { isCronRequest, getAuthedUser, isAdminEmail } from '@/lib/route-auth'

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

  // 인증 이원화 — cron은 CRON_SECRET Bearer, 수동은 세션(본인 또는 관리자)만 허용.
  if (trigger === 'cron') {
    if (!isCronRequest(req)) {
      console.warn(`🚫 [digest] cron 인증 실패 → 401 (userId=${userId})`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    const user = await getAuthedUser()
    if (!user) {
      console.warn(`🚫 [digest] 수동 발송 미인증 → 401 (userId=${userId})`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // 관리자는 지정 userId 실행 허용 (운영 도구), 그 외엔 본인 것만.
    if (user.id !== userId && !isAdminEmail(user.email)) {
      console.warn(`🚫 [digest] 타인 userId 수동 발송 시도 → 403 (caller=${user.id}, target=${userId})`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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

// 첫 정기 발송 시각 기록 (미리보기 제공 여부 판정용).
// .is('first_digest_at', null) 필터로 최초 1회만 기록된다(덮어쓰기 없음).
// 기록 실패가 발송 흐름을 막지 않도록 예외는 로깅만 한다.
async function markFirstDigest(userId: string) {
  try {
    await supabase
      .from('profiles')
      .update({ first_digest_at: new Date().toISOString() })
      .eq('id', userId)
      .is('first_digest_at', null)
  } catch (e) {
    console.error('[digest] first_digest_at 기록 실패:', e)
  }
}

// 발송 시점 스냅샷 보정 — digests는 발송 순간의 상태를 그대로 굳혀 두므로, 발송 뒤에
// 요약이 만들어져도 열람 기록은 "요약 준비 중"인 채로 남는다. 안내를 보고 다시 들어온
// 사용자가 영영 같은 화면을 보지 않도록, 보관 기간 안의 대기 항목만 훑어 채운다.
// - 대상은 아직 결론이 나지 않은 사유뿐. 'temporary'·'no_source'는 재시도가 끝난 상태라 제외하고,
//   'pro_only'는 요약이 있는데 플랜 때문에 잠근 것이라 절대 대상에 넣지 않는다(넣으면 무료에게 풀림).
// - 이미 채워진 행(fail_reason IS NULL)은 조회 조건에서 빠지고, UPDATE에도 같은 조건을 걸어
//   조회~갱신 사이에 채워진 행을 덮어쓰지 않는다.
// 항목별 판정 순서:
//   ① 공유 풀에 요약이 생김            → 채운다(플랜 게이트 통과 후)
//   ② 요약 없음 + 요약 창(2일) 이내     → 그대로 둔다('요약 준비 중' 유지)
//   ③ 요약 없음 + 요약 창 초과          → 'no_source'로 확정('요약 제공 불가'로 표시)
// ③이 필요한 이유: getVideosWithoutSummary가 published_at 기준 SUMMARY_LOOKBACK_DAYS
// 이내만 요약 대상으로 뽑으므로, 그 창을 넘긴 영상은 영영 요약되지 않는다. 그런데도 화면은
// "요약이 완료되면 반영됩니다"라고 계속 안내해 사용자가 오지 않을 것을 기다리게 된다.
// 새 fail_reason 값을 만들지 않고 기존 'no_source'를 재사용한다 — 사용자에게 보이는 문구
// 종류를 늘리지 않기 위함(화면 매핑상 '요약 제공 불가').
// 실패는 전부 삼키고 건수만 돌려준다 — 발송 경로에 영향을 주지 않는다.
const BACKFILL_TARGET_REASONS = ['pending', 'live', 'transcript_failed']

type BackfillResult = {
  filled: number  // ① 요약이 생겨 채우거나 사유를 정정한 건수
  expired: number // ③ 요약 창을 넘겨 '제공 불가'로 확정한 건수
}

async function backfillPendingDigests(
  userId: string,
  userLocale: EmailLocale,
  isPro: boolean
): Promise<BackfillResult> {
  try {
    // 보관 기간 밖은 화면에 뜨지도 않으므로 굳이 채우지 않는다(무료 7일 / Pro 30일).
    const retentionDays = isPro ? 30 : 7
    const cutoffIso = new Date(Date.now() - retentionDays * 86_400_000).toISOString()

    const { data: rows, error } = await supabase
      .from('digests')
      .select('id, video_id, fail_reason, published_at')
      .eq('user_id', userId)
      .in('fail_reason', BACKFILL_TARGET_REASONS)
      .gte('created_at', cutoffIso)
    if (error) {
      console.error(`[digest] 사후 갱신 대상 조회 실패 (userId=${userId}): ${error.message}`)
      return { filled: 0, expired: 0 }
    }
    const targets = (rows ?? []) as {
      id: string; video_id: string; fail_reason: string; published_at: string | null
    }[]
    if (targets.length === 0) return { filled: 0, expired: 0 }

    const videoIds = targets.map(r => r.video_id)
    // service_role이라 RLS와 무관하게 풀 요약을 그대로 읽는다.
    const summaries = await getSummariesFromPool(videoIds, userLocale)

    // 요약 창(SUMMARY_LOOKBACK_DAYS) 판정용 업로드 시각. 요약 대상 선정이 videos.published_at
    // 기준이므로 같은 원본을 우선 본다. 다만 비공개·삭제 영상은 videos에서 제거되므로
    // (video-pool이 delete) 그 행은 여기서 안 잡힌다 → 발송 때 굳혀 둔 digests.published_at으로
    // 폴백한다. 폴백이 없으면 삭제된 영상의 항목이 '요약 준비 중'인 채 영구히 남는다.
    // 둘 다 없으면 ③ 판정만 건너뛴다(그대로 '준비 중' 유지).
    const publishedAt = new Map<string, string>()
    const { data: videoRows, error: videoError } = await supabase
      .from('videos')
      .select('video_id, published_at')
      .in('video_id', videoIds)
    if (videoError) {
      console.error(`[digest] 사후 갱신 published_at 조회 실패 (userId=${userId}): ${videoError.message}`)
    } else {
      for (const v of videoRows ?? []) {
        const pub = (v as any).published_at
        if (pub) publishedAt.set((v as any).video_id, pub)
      }
    }
    const lookbackCutoff = Date.now() - SUMMARY_LOOKBACK_DAYS * 86_400_000

    let updated = 0
    let expired = 0
    for (const row of targets) {
      const s = summaries.get(row.video_id)
      if (!s) {
        // ②/③ — 요약이 아직 없다. 요약 창 안이면 그대로 두고, 넘겼으면 제공 불가로 확정한다.
        const pub = publishedAt.get(row.video_id) ?? row.published_at
        if (!pub) continue // 업로드 시각을 모르면 섣불리 확정하지 않는다
        if (new Date(pub).getTime() >= lookbackCutoff) continue // ② 아직 요약될 수 있음
        const { data: expiredRows, error: expireError } = await supabase
          .from('digests')
          .update({ fail_reason: 'no_source', fail_detail: null })
          .eq('id', row.id)
          .in('fail_reason', BACKFILL_TARGET_REASONS)
          .select('id')
        if (expireError) {
          console.error(`[digest] 사후 확정 실패 (${row.video_id}): ${expireError.message}`)
          continue
        }
        expired += expiredRows?.length ?? 0
        continue
      }

      // ① 요약이 생겼어도 채우기 전에 발송 경로와 같은 게이트를 한 번 더 통과시킨다.
      let patch: Record<string, unknown>
      if (!isPro && isTranscriptFailedSummary(s.summary_basis)) {
        // 자막 확보 실패(우리 쪽 사정)로 설명 대체된 요약 — 무료에겐 계속 숨기고 사유만 정정한다.
        if (row.fail_reason === 'transcript_failed') continue // 이미 그 사유 → 갱신할 것 없음
        patch = { fail_reason: 'transcript_failed', fail_detail: null }
      } else if (!isPro && isDescriptionBasedSummary(s.summary_basis)) {
        // 자막 없는 영상의 설명 기반 요약은 Pro 전용 — 본문을 채우지 말고 잠금 사유로 바꾼다.
        patch = { fail_reason: 'pro_only', fail_detail: null }
      } else {
        // 자막 기반이거나 Pro → 본문을 채우고 사유를 지운다.
        // key_points 정규화는 발송 경로의 upsert와 동일 (풀은 JSONB, digests는 text[]).
        const keyPoints = (Array.isArray(s.key_points) ? s.key_points : []).map((p: any) =>
          typeof p === 'string' ? p : (p?.point ?? p?.text ?? JSON.stringify(p))
        )
        patch = {
          summary: s.summary,
          tldr: s.tldr ?? null,
          key_points: keyPoints,
          timeline: Array.isArray(s.timeline) ? s.timeline : [],
          summary_basis: s.summary_basis ?? '요약',
          fail_reason: null,
          fail_detail: null,
        }
      }

      const { data: changed, error: updateError } = await supabase
        .from('digests')
        .update(patch)
        .eq('id', row.id)
        // 조회 이후 다른 경로가 이미 채웠으면(fail_reason IS NULL) 여기서 걸러진다.
        .in('fail_reason', BACKFILL_TARGET_REASONS)
        .select('id')
      if (updateError) {
        console.error(`[digest] 사후 갱신 실패 (${row.video_id}): ${updateError.message}`)
        continue
      }
      updated += changed?.length ?? 0
    }
    return { filled: updated, expired }
  } catch (e) {
    console.error(`[digest] 사후 갱신 예외 (userId=${userId}):`, e)
    return { filled: 0, expired: 0 }
  }
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

    // 지난 대기 항목 사후 갱신 — 발송과 무관한 정리 작업이므로 이 아래의 어떤 early return
    // (채널 없음 / 새 영상 0개)에도 걸리지 않도록 사용자·플랜 판정 직후에 실행한다.
    // 새 영상이 없는 날이야말로 지난 대기 항목이 남아 있을 가능성이 높다.
    // 내부에서 전부 try-catch → 실패해도 발송에 영향 없음.
    const backfilled = await backfillPendingDigests(userId, userLocale, !!isPro)
    if (backfilled.filled > 0) {
      console.log(`🔄 [digest] 열람 기록 사후 갱신 ${backfilled.filled}건 (userId=${userId})`)
    }
    if (backfilled.expired > 0) {
      console.log(`⏹ [digest] 요약 창(${SUMMARY_LOOKBACK_DAYS}일) 초과 → 제공 불가 확정 ${backfilled.expired}건 (userId=${userId})`)
    }

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
          // 위 분기가 trigger === 'cron' 한정이라 현재 isManual은 항상 false지만,
          // 조건이 바뀌어도 수동 실행이 정기 발송 장부에 섞이지 않도록 같은 기준을 건다.
          await deliverEmptyDigest(settings, userName, userLocale, userId, isManual ? 'admin' : 'digest')
          // 정기 발송이 실제로 나갔으므로 첫 발송 시각 기록 (Cloudflare에서 floating promise는
          // 완료 보장이 안 되므로 await).
          await markFirstDigest(userId)
        } catch (e) {
          console.error(`[digest] 빈 다이제스트 메일 발송 실패 userId=${userId}:`, e)
          await logErrorEvent({ source: 'digest', failReason: 'send_error', failDetail: `빈 다이제스트 발송 실패 (userId=${userId}): ${String(e)}` })
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

    // 실패 사유 → 요약 자리에 넣을 문구(라벨+설명). 묶음은 email-templates의
    // failReasonTranslationKeys 하나만 쓴다 — 채널마다 매핑이 갈리지 않도록.
    // 메일 카드는 이 문자열 대신 failReason으로 직접 렌더하므로, 이 값은
    // digests.summary 저장분과 텔레그램 본문에 쓰인다.
    const failText = (failReason: string | null): string | null => {
      const keys = failReasonTranslationKeys(failReason ?? undefined)
      if (!keys) return null
      return `${et(userLocale, keys.labelKey)}\n${et(userLocale, keys.noteKey)}`
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
      } else if (!isPro && isTranscriptFailedSummary(s.summary_basis)) {
        // 자막 확보 실패(크레딧 소진·API 오류)로 설명 대체된 요약 — 숨기는 것은 pro_only와 같되
        // 우리 쪽 사정이므로 사유를 정직하게 표기하고 Pro 유도 문구는 쓰지 않는다.
        failReason = 'transcript_failed'
      } else if (!isPro && isDescriptionBasedSummary(s.summary_basis)) {
        // 자막 없는 영상(설명 기반 요약)은 Pro 전용 — 무료 사용자에겐 안내 문구만 발송·저장.
        // 알 수 없는 basis 값은 게이트하지 않음(isDescriptionBasedSummary가 false 반환).
        failReason = 'pro_only'
      }
      // pro_only / transcript_failed: 요약은 풀에 존재하지만 본문·포인트·타임라인을 이메일/digests에 노출하지 않음
      const withheld = failReason === 'pro_only' || failReason === 'transcript_failed'
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
          // 역피라미드 최상단 한 줄(이메일 전용). 요약 숨김(pro_only) 시 미노출, null→undefined 정규화.
          tldr: (!withheld && typeof s?.tldr === 'string') ? s.tldr : undefined,
          // 요약 없음·pro_only: 사유별 구분 문구 (텔레그램 등 요약 텍스트를 그대로 쓰는 채널 호환)
          summary: (withheld ? null : s?.summary) ?? failText(failReason) ?? et(userLocale, 'digest.summaryUnavailable'),
          // 풀(JSONB)에서 온 값이 배열이 아닐 수 있음 → 이후 .map() TypeError 방지
          keyPoints: !withheld && Array.isArray(s?.key_points) ? s.key_points : [],
          timeline: !withheld && Array.isArray(s?.timeline) ? s.timeline : [],
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
          reason: failReason ?? undefined, // 텔레그램 알림 표기용 (이메일 포맷 불변)
        })
      }
    }

    // 다이제스트 이메일 발송
    // (cron 한정) 오늘 이미 실제 발송됐으면 스킵 — send_log 재선점 복구의 중복 발송 방지 교차 확인.
    if (digestItems.length > 0) {
      const alreadySent = trigger === 'cron' && (await hasDigestSentToday(userId))
      if (alreadySent) {
        console.log(`[digest] 오늘 이미 발송됨(email_logs) → 발송 스킵, sent 마킹만 진행 user=${userId}`)
      } else {
        // 관리자 수동 실행은 email_logs에 'admin'으로 남긴다 — 'digest'로 남기면
        // hasDigestSentToday가 이를 세어 그날 정기 발송이 통째로 스킵된다.
        // ※ manual 경로 자체는 관리자 전용이 아니다(세션 본인도 호출 가능). 다만 현재 UI에서
        //   manual을 호출하는 곳은 /admin/system뿐이라 'admin'으로 기록해도 무방하다.
        await deliverDigest(settings, userName, digestItems, userLocale, userId, isPro, isManual ? 'admin' : 'digest')
      }
      // 정기 발송(스킵 포함 = 오늘 이미 발송됨) 완료 → 첫 발송 시각 기록.
      if (trigger === 'cron') await markFirstDigest(userId)
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
          await logErrorEvent({
            source: 'breaking',
            videoId: item.video.videoId,
            videoTitle: item.video.title,
            channelName: item.channel,
            failReason: 'send_error',
            failDetail: String(e),
          })
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
            tldr: item.summary.tldr ?? null,
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

    // 오류 항목 번들 알림 (요약 누락 등) — admin_alert_settings에 따라 메일/텔레그램 분기.
    // 내부에서 전부 try-catch 하므로 실패해도 응답엔 영향 없음.
    if (failedItems.length > 0) {
      console.log(`[digest] 관리자 오류 알림 시도: userId=${userId}, failedCount=${failedItems.length}`)
      await sendAdminFailureAlert(userName, settings.email, userId, failedItems, trigger)
    }

    // 오래된 기록 삭제 (digests 30일 + error_log 30일 + 만료 공유 링크 7일 유예)
    await supabase.rpc('delete_old_digests')
    await cleanupOldErrorLogs()
    await cleanupExpiredShares()

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
    await logErrorEvent({ source: 'digest', failDetail: `digest 처리 실패 (userId=${userId}, trigger=${trigger}): ${String(error)}` })
    return { status: 500, body: { error: '서버 오류' } }
  }
}