// 4b단계: 채널 공유 "수집" 로직 (사용자 무관, 영상당 1번 요약 캐시).
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
// ⚠️ 아직 발송 흐름에 연결되지 않음 (4c에서 전환). 기존 digests 발송은 그대로 동작.
import { createClient } from '@supabase/supabase-js'
import { nowUtc } from './time'
import { getTranscript, summarizeVideo } from './gemini'
import { logErrorEvent } from './error-log'
import type { Locale } from './i18n/translations'

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

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!

// 채널당 playlistItems 페이지 상한 (쿼터/시간 보호).
// 증분 수집(last_video_published_at 이후만)이므로 2페이지면 신규분 충분.
const MAX_PAGES = 2
// 요약 대상 기간 (일). 발송에 쓰이는 어제+당일만 요약 → 과거 영상 Gemini 낭비 방지.
const SUMMARY_LOOKBACK_DAYS = 2
// 한 번 수집 실행에서 요약할 영상 상한 (60초 budget 보호)
// ⚠️ 요약은 영상당 자막+Gemini로 느려서 작게 유지. 나머지는 다음 주기 + 발송 시 폴백 C가 처리.
const SUMMARY_LIMIT = 5
// 요약 동시 처리 수
const SUMMARY_CONCURRENCY = 5
// 요약 재시도 상한. 비공개/삭제 등 영구 실패 영상이 15분 cron마다 무한 재시도되며
// Supadata 크레딧(실패도 1크레딧)·Gemini 호출을 낭비하는 것을 막는다.
export const MAX_SUMMARY_ATTEMPTS = 3

// 60초 함수 budget 보호용 시간 컷오프 (ms, 실행 시작 기준)
const COLLECT_CUTOFF_MS = 35_000 // 이후엔 새 채널 수집 중단 (다음 주기로 이월)
const SUMMARY_START_CUTOFF_MS = 25_000 // 이후엔 새 요약 배치를 시작하지 않음 (배치가 ~30s까지 갈 수 있어 60s 내 종료 보장)

export type UniqueChannel = {
  channelId: string
  uploadsPlaylistId: string | null
}

// ── 고유 채널 목록 ─────────────────────────────────────────────
// 활성 사용자들이 구독한 "고유 채널" (channel_id 기준 DISTINCT).
export async function getUniqueChannels(): Promise<UniqueChannel[]> {
  const { data: activeSettings } = await supabase
    .from('settings')
    .select('user_id')
    .eq('active', true)

  const activeUserIds = (activeSettings ?? []).map(s => s.user_id)
  if (!activeUserIds.length) return []

  const { data: channels } = await supabase
    .from('channels')
    .select('channel_id, uploads_playlist_id, is_active')
    .in('user_id', activeUserIds)

  const byChannel = new Map<string, UniqueChannel>()
  for (const c of channels ?? []) {
    const channelId = (c as any).channel_id as string | null
    if (!channelId) continue
    if ((c as any).is_active === false) continue
    const uploadsPlaylistId = ((c as any).uploads_playlist_id as string | null) ?? null
    const existing = byChannel.get(channelId)
    if (!existing) byChannel.set(channelId, { channelId, uploadsPlaylistId })
    else if (!existing.uploadsPlaylistId && uploadsPlaylistId) existing.uploadsPlaylistId = uploadsPlaylistId
  }
  return [...byChannel.values()]
}

// ── YouTube 헬퍼 ──────────────────────────────────────────────
// ISO8601 (PT1M30S) → 초
function parseDurationToSeconds(duration: string): number {
  const m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

// 쇼츠 판별 (길이 ≤ 60초 또는 제목에 #shorts)
export function isShort(durationSeconds?: number, title?: string): boolean {
  if (durationSeconds != null && durationSeconds > 0 && durationSeconds <= 60) return true
  if (title && /#shorts/i.test(title)) return true
  return false
}

// 채널의 업로드 재생목록 ID (channels.list contentDetails, 1 unit)
async function getUploadsPlaylistId(channelId: string): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
  )
  const data = await res.json()
  if (!res.ok || data.error) {
    console.error(`❌ channels.list 오류 (channel=${channelId}): ${data.error?.message ?? res.status}`)
    return null
  }
  return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null
}

type PlaylistVideo = { videoId: string; title: string; publishedAt: string }

// playlistItems 한 페이지 (1 unit)
async function fetchPlaylistItems(
  playlistId: string,
  pageToken?: string
): Promise<{ items: PlaylistVideo[]; nextPageToken?: string; error?: boolean }> {
  const url =
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails` +
    `&playlistId=${playlistId}&maxResults=50&key=${YOUTUBE_API_KEY}` +
    (pageToken ? `&pageToken=${pageToken}` : '')
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) {
    console.error(`❌ playlistItems 오류 (playlist=${playlistId}): ${data.error?.message ?? res.status}`)
    return { items: [], error: true }
  }
  const items: PlaylistVideo[] = (data.items ?? []).map((it: any) => ({
    videoId: it.contentDetails?.videoId,
    title: it.snippet?.title ?? '',
    // 업로드 시각: contentDetails.videoPublishedAt 우선 (UTC ISO)
    publishedAt: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt,
  })).filter((v: PlaylistVideo) => Boolean(v.videoId) && Boolean(v.publishedAt))
  return { items, nextPageToken: data.nextPageToken }
}

type VideoDetail = { durationSeconds: number; description: string; title: string; liveBroadcastContent: string }

// 영상 상세 배치 (videos.list contentDetails+snippet, 50개당 1 unit)
async function getVideoDetailsBatch(videoIds: string[]): Promise<Map<string, VideoDetail>> {
  const out = new Map<string, VideoDetail>()
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${batch.join(',')}&key=${YOUTUBE_API_KEY}`
    )
    const data = await res.json()
    if (!res.ok || data.error) {
      console.error(`❌ videos.list 오류: ${data.error?.message ?? res.status}`)
      continue
    }
    for (const v of data.items ?? []) {
      out.set(v.id, {
        durationSeconds: parseDurationToSeconds(v.contentDetails?.duration ?? ''),
        description: (v.snippet?.description ?? '').slice(0, 2000),
        title: v.snippet?.title ?? '',
        // 라이브/예정 판별 (part=snippet에 포함 → 추가 비용 없음). none | live | upcoming
        liveBroadcastContent: v.snippet?.liveBroadcastContent ?? 'none',
      })
    }
  }
  return out
}

// 라이브/예정 영상의 현재 상태 재확인 (videos.list snippet, 1 unit).
// 확인 실패 시 null → 이번 주기는 건너뜀 (자막 API 크레딧 낭비 방지).
async function fetchLiveBroadcastContent(videoId: string): Promise<string | null> {
  try {
    // Cloudflare 호환: env는 함수 내부에서 읽는다.
    const apiKey = process.env.YOUTUBE_API_KEY!
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`
    )
    const data = await res.json()
    if (!res.ok || data.error || !data.items?.length) return null
    return data.items[0]?.snippet?.liveBroadcastContent ?? 'none'
  } catch {
    return null
  }
}

// ── 채널 영상 수집 ────────────────────────────────────────────
type ChannelState = {
  uploads_playlist_id: string | null
  last_video_published_at: string | null
}

async function getChannelState(channelId: string): Promise<ChannelState | null> {
  const { data } = await supabase
    .from('channel_fetch_state')
    .select('uploads_playlist_id, last_video_published_at')
    .eq('channel_id', channelId)
    .maybeSingle()
  return (data as ChannelState) ?? null
}

// 한 채널의 새 영상을 videos 테이블에 적재. 새로 적재한 개수 반환.
async function collectChannelVideos(channel: UniqueChannel): Promise<number> {
  const state = await getChannelState(channel.channelId)

  // uploads 재생목록 ID (캐시 우선)
  let playlistId = state?.uploads_playlist_id ?? channel.uploadsPlaylistId ?? null
  if (!playlistId) {
    playlistId = await getUploadsPlaylistId(channel.channelId)
    if (playlistId) {
      // channels 행에도 캐시 (해당 채널 구독 행 전부)
      await supabase.from('channels').update({ uploads_playlist_id: playlistId }).eq('channel_id', channel.channelId)
    }
  }
  if (!playlistId) {
    console.log(`📡 ${channel.channelId}: uploads 재생목록 없음 → 스킵`)
    return 0
  }

  const lastSeen = state?.last_video_published_at ? new Date(state.last_video_published_at) : null

  // 새 영상 수집 (last_video_published_at 이후만)
  const newVideos: PlaylistVideo[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPlaylistItems(playlistId, pageToken)
    if (res.error) break

    let reachedOld = false
    for (const item of res.items) {
      const published = new Date(item.publishedAt)
      if (lastSeen && published <= lastSeen) { reachedOld = true; break }
      newVideos.push(item)
    }
    if (reachedOld || !res.nextPageToken) break
    pageToken = res.nextPageToken
  }

  if (newVideos.length === 0) {
    // 그래도 조회 시각은 갱신
    await upsertChannelState(channel.channelId, playlistId, lastSeen?.toISOString() ?? null)
    console.log(`📡 ${channel.channelId}: 새 영상 0개`)
    return 0
  }

  // 상세(길이/설명) 배치 조회 → 쇼츠 판별 + videos upsert
  const details = await getVideoDetailsBatch(newVideos.map(v => v.videoId))
  const rows = newVideos.map(v => {
    const d = details.get(v.videoId)
    // 라이브/예정 영상은 요약 대상이 아님 → 수집 시점에 사유를 함께 기록 (요약 주기에서 skip)
    const isLive = d?.liveBroadcastContent === 'live' || d?.liveBroadcastContent === 'upcoming'
    return {
      video_id: v.videoId,
      channel_id: channel.channelId,
      title: v.title || d?.title || '',
      published_at: v.publishedAt, // UTC 그대로
      duration_seconds: d?.durationSeconds ?? null,
      is_short: isShort(d?.durationSeconds, v.title || d?.title),
      description: d?.description ?? null,
      live_broadcast_content: d?.liveBroadcastContent ?? null,
      fail_reason: isLive ? 'live' : null,
      fail_detail: isLive ? `liveBroadcastContent=${d?.liveBroadcastContent}` : null,
      fetched_at: nowUtc().toISOString(),
    }
  })
  // video_id PRIMARY KEY → upsert로 중복 자동 방지
  await supabase.from('videos').upsert(rows, { onConflict: 'video_id' })

  // 라이브/예정 감지 영상은 관리자 오류 로그에도 적재 (video_id+reason 중복 시 skip)
  for (const row of rows) {
    if (row.fail_reason === 'live') {
      await logErrorEvent({
        source: 'summary',
        videoId: row.video_id,
        videoTitle: row.title,
        channelId: channel.channelId,
        failReason: 'live',
        failDetail: row.fail_detail,
        dedupe: true,
      })
    }
  }

  // 가장 최신 영상의 publishedAt으로 상태 갱신 (newVideos[0]이 최신)
  const newest = newVideos.reduce((a, b) => (new Date(a.publishedAt) >= new Date(b.publishedAt) ? a : b))
  await upsertChannelState(channel.channelId, playlistId, newest.publishedAt)

  console.log(`📡 ${channel.channelId}: 새 영상 ${rows.length}개 적재`)
  return rows.length
}

async function upsertChannelState(channelId: string, playlistId: string | null, lastVideoPublishedAt: string | null) {
  await supabase.from('channel_fetch_state').upsert(
    {
      channel_id: channelId,
      uploads_playlist_id: playlistId,
      last_fetched_at: nowUtc().toISOString(),
      last_video_published_at: lastVideoPublishedAt,
    },
    { onConflict: 'channel_id' }
  )
}

// ── 공유 요약 (영상당 1번) ────────────────────────────────────
type PendingVideo = {
  video_id: string
  title: string
  description: string | null
  summary_attempts?: number | null
  live_broadcast_content?: string | null
  fail_reason?: string | null
  transcript_checked?: boolean | null // 자막 없음 확정 → 이후 주기엔 자막 API 재호출 스킵
}

// 아직 요약이 없는 (쇼츠 아닌, 최근 N일) 영상 목록.
// ⚠️ 과거 영상은 발송에 안 쓰이므로 요약하지 않는다 (Gemini 비용 절감).
async function getVideosWithoutSummary(locale: Locale = 'ko', limit: number = SUMMARY_LIMIT): Promise<PendingVideo[]> {
  const cutoff = new Date(Date.now() - SUMMARY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const { data: vids } = await supabase
    .from('videos')
    .select('video_id, title, description, summary_attempts, live_broadcast_content, fail_reason, transcript_checked')
    .eq('is_short', false)
    .gte('published_at', cutoff.toISOString())
    .lt('summary_attempts', MAX_SUMMARY_ATTEMPTS) // 재시도 상한 초과는 영구 제외
    .order('published_at', { ascending: false })
    .limit(200)

  const candidates = (vids ?? []) as PendingVideo[]
  if (!candidates.length) return []

  const { data: existing } = await supabase
    .from('video_summaries')
    .select('video_id')
    .in('video_id', candidates.map(v => v.video_id))
    .eq('locale', locale)

  const have = new Set((existing ?? []).map(e => (e as any).video_id))
  return candidates.filter(v => !have.has(v.video_id)).slice(0, limit)
}

// 동시성 제한 배치 처리
async function processInBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn))
  }
}

// Gemini 응답이 가끔 배열이 아닌 형태로 와도 JSONB엔 항상 배열로 저장 (렌더 .map 안전)
function asArray<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

// 요약 실패 시 재시도 카운트 +1 + 사유 기록 (실패해도 흐름을 막지 않게 best-effort).
// 상한 도달 전엔 'pending'(다음 주기 재시도), 도달 시 종결 사유(no_source/temporary)를 기록.
async function bumpSummaryAttempts(video: PendingVideo, cause: 'no_source' | 'temporary', detail: string): Promise<void> {
  const next = (video.summary_attempts ?? 0) + 1
  const failReason = next >= MAX_SUMMARY_ATTEMPTS ? cause : 'pending'
  const { error } = await supabase
    .from('videos')
    .update({ summary_attempts: next, fail_reason: failReason, fail_detail: detail.slice(0, 500) })
    .eq('video_id', video.video_id)
  if (error) console.error(`❌ summary_attempts 증가 실패 (${video.video_id}): ${error.message}`)
  // 최종 실패 확정(상한 도달) 시에만 관리자 오류 로그 적재 (pending은 소음 방지 위해 제외)
  if (next >= MAX_SUMMARY_ATTEMPTS) {
    await logErrorEvent({
      source: 'summary',
      videoId: video.video_id,
      videoTitle: video.title,
      failReason: cause,
      failDetail: detail,
      dedupe: true,
    })
  }
}

// 영상 1개 요약 → video_summaries upsert. 4b 수집·4c 폴백 공용.
// 반환: stored=저장 성공 여부, transcriptExhausted=이번 호출에서 자막 API 크레딧 소진(429/402) 감지 여부.
// options.skipTranscript=true 이거나 video.transcript_checked=true 이면 자막 API를 건너뛰고
//   기존 video.description만으로 요약(소진 API를 더 두드리지 않음 / 자막 없음 확정 영상 재호출 방지).
type StoreResult = { stored: boolean; transcriptExhausted: boolean }
async function summarizeAndStore(
  video: PendingVideo,
  locale: Locale = 'ko',
  options?: { skipTranscript?: boolean }
): Promise<StoreResult> {
  // 라이브/예정 영상: 요약 시도 없이 skip. summary_attempts는 소모하지 않는다
  // (라이브 종료 후 일반 영상이 되면 다음 실행에서 정상 요약되도록).
  const markedLive =
    video.live_broadcast_content === 'live' ||
    video.live_broadcast_content === 'upcoming' ||
    video.fail_reason === 'live'
  if (markedLive) {
    const fresh = await fetchLiveBroadcastContent(video.video_id)
    if (fresh !== 'none') {
      // 아직 라이브/예정 (또는 확인 실패 → 다음 주기 재확인). 자막 API 호출 전에 차단해 크레딧 낭비 방지.
      if (fresh) {
        await supabase
          .from('videos')
          .update({ live_broadcast_content: fresh, fail_reason: 'live', fail_detail: `liveBroadcastContent=${fresh}` })
          .eq('video_id', video.video_id)
        // 라이브 감지 적재 (수집 시 이미 적재됐으면 dedupe로 skip)
        await logErrorEvent({
          source: 'summary',
          videoId: video.video_id,
          videoTitle: video.title,
          failReason: 'live',
          failDetail: `liveBroadcastContent=${fresh}`,
          dedupe: true,
        })
      }
      console.log(`📺 라이브/예정 영상 → 요약 제외 (${video.video_id}): liveBroadcastContent=${fresh ?? 'unknown'}`)
      return { stored: false, transcriptExhausted: false }
    }
    // 라이브 종료 → 일반 영상으로 전환 후 요약 진행
    await supabase
      .from('videos')
      .update({ live_broadcast_content: 'none', fail_reason: null, fail_detail: null })
      .eq('video_id', video.video_id)
    console.log(`📺 라이브 종료 감지 → 일반 요약 진행 (${video.video_id})`)
  }

  // 자막 API 호출 여부 결정:
  //  - options.skipTranscript: 이번 실행에서 이미 소진(429/402) 감지 → 남은 영상은 자막 API 스킵
  //  - video.transcript_checked: 과거에 자막 없음이 "확정"된 영상 → 자막 API 재호출 불필요
  // 둘 중 하나라도 참이면 자막 API를 건너뛰고 기존 video.description만으로 요약한다.
  const skipTranscript = options?.skipTranscript === true || video.transcript_checked === true
  let transcript = ''
  let description = ''
  let exhausted = false
  if (skipTranscript) {
    console.log(
      `⏭ 자막 API 스킵(${options?.skipTranscript ? '이번 실행 소진' : '자막없음 확정'}) → 설명 기반 처리: ${video.video_id}`
    )
  } else {
    const tr = await getTranscript(video.video_id) // userId 없음 (공유)
    // 비공개/삭제 영상: Gemini 호출 없이 풀에서 제거 (발송 대상에서도 빠짐)
    if (tr.unavailable) {
      const { error } = await supabase.from('videos').delete().eq('video_id', video.video_id)
      if (error) console.error(`❌ 비공개/삭제 영상 제거 실패 (${video.video_id}): ${error.message}`)
      console.log(`🗑 비공개/삭제 영상 제거: ${video.video_id}`)
      return { stored: false, transcriptExhausted: tr.transcriptExhausted === true }
    }
    transcript = tr.transcript
    description = tr.description
    exhausted = tr.transcriptExhausted === true
    // 자막 없음이 "확정"(콘텐츠 없음)이고 소진이 아니면 → 이후 주기 자막 재호출 방지 플래그 기록.
    // 소진(429/402)일 땐 세우지 않는다(충전/유료 전환 후 자막 있을 수 있으므로).
    if (!transcript && tr.transcriptMissing === true && !exhausted && video.transcript_checked !== true) {
      const { error } = await supabase.from('videos').update({ transcript_checked: true }).eq('video_id', video.video_id)
      if (error) console.error(`❌ transcript_checked 기록 실패 (${video.video_id}): ${error.message}`)
      else console.log(`📝 자막 없음 확정 → transcript_checked=true: ${video.video_id}`)
    }
  }

  // video.description이 빈 문자열('')이면 ??가 통과시켜 getTranscript가 가져온 설명을 못 씀 → trim 검사
  const desc = video.description?.trim() ? video.description : description
  const result = await summarizeVideo(null, video.title, transcript, desc, locale)
  // 일시적 실패(429/자막 실패 등)는 가짜 성공 객체로 돌아온다. 이걸 저장하면
  // 실패 문구가 공유 풀에 영구 캐시되어 모든 사용자가 영원히 실패본을 받는다.
  // → 저장하지 않으면 다음 주기/발송 폴백에서 자동 재시도됨 (단 상한까지만).
  if (result.errorInfo || result.summaryBasis === '요약 실패') {
    const cause = result.failReason === 'no_source' ? 'no_source' : 'temporary'
    const detail = result.errorInfo ?? result.summaryBasis
    console.error(`❌ 요약 실패 → 저장 생략, 재시도 대기 (${video.video_id}): ${detail}`)
    await bumpSummaryAttempts(video, cause, detail)
    return { stored: false, transcriptExhausted: exhausted }
  }
  const { error } = await supabase.from('video_summaries').upsert(
    {
      video_id: video.video_id,
      locale,
      tldr: result.tldr ?? '', // 한 줄 요약 (품질 평가용, UI 미노출)
      summary: result.summary,
      key_points: asArray(result.keyPoints), // JSONB 배열로 정규화
      timeline: asArray(result.timeline), // JSONB 배열로 정규화
      model: result.model ?? null,
      summary_basis: result.summaryBasis ?? null, // 분석 근거(자막/설명/제목) 표기용
    },
    { onConflict: 'video_id,locale' }
  )
  if (error) {
    console.error(`❌ video_summaries 적재 실패 (${video.video_id}): ${error.message}`)
    await bumpSummaryAttempts(video, 'temporary', `video_summaries upsert: ${error.message}`)
    return { stored: false, transcriptExhausted: exhausted }
  }
  // 요약 성공 → 이전 실패/대기 사유 정리 (fail_reason/fail_detail = null)
  if (video.fail_reason || (video.summary_attempts ?? 0) > 0) {
    await supabase.from('videos').update({ fail_reason: null, fail_detail: null }).eq('video_id', video.video_id)
  }
  return { stored: true, transcriptExhausted: exhausted }
}

// 미요약 영상 요약 → video_summaries 적재 (영상당 1번, 전역 공유). 요약한 개수 반환.
// deadlineTs(ms): 이 시각을 넘으면 다음 배치를 시작하지 않음 (60초 budget 보호).
export async function summarizePendingVideos(deadlineTs?: number, locale: Locale = 'ko'): Promise<number> {
  // Cloudflare Workers subrequest 한도 보호. 모듈 최상단이 아닌 요청 시점에 읽어야 한다(Cloudflare lazy eval).
  // 영상 1개 ≈ subrequest 3~4개(자막+설명+Gemini). 무료 한도(50) 기준 보수적으로 기본 10.
  const maxSummaries = Number(process.env.MAX_SUMMARIES_PER_RUN ?? 10)
  const pending = await getVideosWithoutSummary(locale, maxSummaries)
  console.log(`🤖 요약 대기: ${pending.length}개 (이번 실행 최대 ${maxSummaries}개)`)
  if (!pending.length) return 0

  let done = 0
  let attempted = 0
  // 이번 실행 한정 소진 플래그(전역 영구 아님). 자막 API가 429/402를 한 번 반환하면
  // 이후 영상은 자막 API 호출을 건너뛰고 설명 기반으로만 처리 → 크레딧 폭탄 방지.
  // 다음 cron에선 다시 false로 시작(충전/유료 전환 대비).
  let transcriptExhaustedThisRun = false
  for (let i = 0; i < pending.length; i += SUMMARY_CONCURRENCY) {
    if (attempted >= maxSummaries) {
      console.log(`⏱ subrequest 상한(${maxSummaries}) 도달 → 나머지 ${pending.length - i}개는 다음 주기로 이월`)
      break
    }
    if (deadlineTs && Date.now() > deadlineTs) {
      console.log(`⏱ 요약 시간 budget 도달 → 나머지는 다음 주기/발송 폴백으로 이월`)
      break
    }
    const batch = pending.slice(i, i + SUMMARY_CONCURRENCY)
    const skipTranscript = transcriptExhaustedThisRun
    await Promise.allSettled(batch.map(async v => {
      attempted++
      const r = await summarizeAndStore(v, locale, { skipTranscript })
      if (r.stored) done++
      if (r.transcriptExhausted) transcriptExhaustedThisRun = true
    }))
    if (transcriptExhaustedThisRun && !skipTranscript) {
      console.log(`⛔ 자막 API 크레딧 소진 감지 → 이후 영상은 설명 기반으로만 처리(이번 실행 한정)`)
    }
  }
  console.log(`🤖 요약 완료: ${done}개`)
  return done
}

// ── 4c 발송용: 공유 풀 조회 ───────────────────────────────────
export type PoolVideo = {
  video_id: string
  channel_id: string
  title: string
  published_at: string
  duration_seconds: number | null
  is_short: boolean
  description: string | null
  summary_attempts?: number | null
  live_broadcast_content?: string | null
  fail_reason?: string | null
  fail_detail?: string | null
}

export type PoolSummary = {
  video_id: string
  locale: string
  summary: string | null
  key_points: string[] | null
  timeline: { time: string; content: string }[] | null
  model: string | null
  summary_basis: string | null
}

// 채널들의 특정 기간(UTC) 영상 (쇼츠 제외, 공유 풀)
export async function getVideosFromPool(channelIds: string[], start: Date, end: Date): Promise<PoolVideo[]> {
  if (!channelIds.length) return []
  const { data } = await supabase
    .from('videos')
    .select('video_id, channel_id, title, published_at, duration_seconds, is_short, description, summary_attempts, live_broadcast_content, fail_reason, fail_detail')
    .in('channel_id', channelIds)
    .gte('published_at', start.toISOString())
    .lt('published_at', end.toISOString())
    .eq('is_short', false)
    .order('published_at', { ascending: false })
  return (data ?? []) as PoolVideo[]
}

// 채널들의 최근(sinceUtc 이후) 영상 — 속보 감지용 (쇼츠 제외)
export async function getRecentPoolVideos(channelIds: string[], sinceUtc: Date): Promise<PoolVideo[]> {
  if (!channelIds.length) return []
  const { data } = await supabase
    .from('videos')
    .select('video_id, channel_id, title, published_at, duration_seconds, is_short, description')
    .in('channel_id', channelIds)
    .gte('published_at', sinceUtc.toISOString())
    .eq('is_short', false)
    .order('published_at', { ascending: false })
    .limit(200)
  return (data ?? []) as PoolVideo[]
}

// 영상 요약 일괄 조회 (Map)
export async function getSummariesFromPool(videoIds: string[], locale: Locale = 'ko'): Promise<Map<string, PoolSummary>> {
  const map = new Map<string, PoolSummary>()
  if (!videoIds.length) return map
  const { data } = await supabase
    .from('video_summaries')
    .select('video_id, locale, summary, key_points, timeline, model, summary_basis')
    .in('video_id', videoIds)
    .eq('locale', locale)
  for (const s of (data ?? []) as PoolSummary[]) map.set(s.video_id, s)
  return map
}

// 단일 영상 요약 조회 (속보 폴백용)
export async function getSummary(videoId: string, locale: Locale = 'ko'): Promise<PoolSummary | null> {
  const { data } = await supabase
    .from('video_summaries')
    .select('video_id, locale, summary, key_points, timeline, model, summary_basis')
    .eq('video_id', videoId)
    .eq('locale', locale)
    .maybeSingle()
  return (data as PoolSummary) ?? null
}

// 폴백 C: 풀에 요약이 없는 영상을 즉시 요약 (videos에 있는 영상 대상). 요약한 개수 반환.
export async function summarizeNow(videoIds: string[], locale: Locale = 'ko'): Promise<number> {
  if (!videoIds.length) return 0
  const { data } = await supabase
    .from('videos')
    .select('video_id, title, description, summary_attempts, live_broadcast_content, fail_reason, transcript_checked')
    .in('video_id', videoIds)
    .lt('summary_attempts', MAX_SUMMARY_ATTEMPTS) // 재시도 상한 초과는 즉시요약 대상에서도 제외
  const targets = (data ?? []) as PendingVideo[]
  if (!targets.length) return 0

  let done = 0
  await processInBatches(targets, SUMMARY_CONCURRENCY, async (video) => {
    if ((await summarizeAndStore(video, locale)).stored) done++
  })
  return done
}

// 사용자별 속보 키워드 매칭 (공유 풀엔 is_breaking 없음 → 발송 시 각자 판정)
export function matchesKeyword(title: string, keywords: string[] | null | undefined): boolean {
  if (!keywords || keywords.length === 0) return false
  const lower = title.toLowerCase()
  return keywords.some(kw => kw && lower.includes(kw.trim().toLowerCase()))
}

// ── 오케스트레이터 ────────────────────────────────────────────
export async function runCollection(): Promise<{
  channels: number
  channelsProcessed: number
  collected: number
  summarized: number
  timedOutCollecting: boolean
}> {
  const t0 = Date.now()
  const channels = await getUniqueChannels()
  console.log(`📡 수집 대상 고유 채널: ${channels.length}개`)

  let collected = 0
  let processed = 0
  let timedOut = false
  for (const channel of channels) {
    // 60초 budget 보호: 일정 시각 넘으면 나머지 채널은 다음 주기로 이월
    if (Date.now() - t0 > COLLECT_CUTOFF_MS) {
      timedOut = true
      console.log(`⏱ 수집 시간 budget 도달 → 채널 ${channels.length - processed}개는 다음 주기로 이월`)
      break
    }
    try {
      collected += await collectChannelVideos(channel)
    } catch (e) {
      console.error(`❌ 채널 수집 실패 (${channel.channelId}):`, e)
    }
    processed++
  }

  // 남은 시간 안에서만 요약 (배치가 ~30s까지 갈 수 있어 시작 컷오프를 보수적으로)
  const summarized = await summarizePendingVideos(t0 + SUMMARY_START_CUTOFF_MS)
  console.log(
    `✅ 수집 완료: 채널 ${processed}/${channels.length} / 신규영상 ${collected} / 요약 ${summarized} / 소요 ${((Date.now() - t0) / 1000).toFixed(1)}s`
  )
  return { channels: channels.length, channelsProcessed: processed, collected, summarized, timedOutCollecting: timedOut }
}
