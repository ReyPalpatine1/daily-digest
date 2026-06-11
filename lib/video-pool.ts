// 4b단계: 채널 공유 "수집" 로직 (사용자 무관, 영상당 1번 요약 캐시).
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
// ⚠️ 아직 발송 흐름에 연결되지 않음 (4c에서 전환). 기존 digests 발송은 그대로 동작.
import { createClient } from '@supabase/supabase-js'
import { nowUtc } from './time'
import { getTranscript, summarizeVideo } from './gemini'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

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

type VideoDetail = { durationSeconds: number; description: string; title: string }

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
      })
    }
  }
  return out
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
    return {
      video_id: v.videoId,
      channel_id: channel.channelId,
      title: v.title || d?.title || '',
      published_at: v.publishedAt, // UTC 그대로
      duration_seconds: d?.durationSeconds ?? null,
      is_short: isShort(d?.durationSeconds, v.title || d?.title),
      description: d?.description ?? null,
      fetched_at: nowUtc().toISOString(),
    }
  })
  // video_id PRIMARY KEY → upsert로 중복 자동 방지
  await supabase.from('videos').upsert(rows, { onConflict: 'video_id' })

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
type PendingVideo = { video_id: string; title: string; description: string | null }

// 아직 요약이 없는 (쇼츠 아닌, 최근 N일) 영상 목록.
// ⚠️ 과거 영상은 발송에 안 쓰이므로 요약하지 않는다 (Gemini 비용 절감).
async function getVideosWithoutSummary(): Promise<PendingVideo[]> {
  const cutoff = new Date(Date.now() - SUMMARY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const { data: vids } = await supabase
    .from('videos')
    .select('video_id, title, description')
    .eq('is_short', false)
    .gte('published_at', cutoff.toISOString())
    .order('published_at', { ascending: false })
    .limit(200)

  const candidates = (vids ?? []) as PendingVideo[]
  if (!candidates.length) return []

  const { data: existing } = await supabase
    .from('video_summaries')
    .select('video_id')
    .in('video_id', candidates.map(v => v.video_id))

  const have = new Set((existing ?? []).map(e => (e as any).video_id))
  return candidates.filter(v => !have.has(v.video_id)).slice(0, SUMMARY_LIMIT)
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

// 영상 1개 요약 → video_summaries upsert (성공 시 true). 4b 수집·4c 폴백 공용.
async function summarizeAndStore(video: PendingVideo): Promise<boolean> {
  const { transcript, description } = await getTranscript(video.video_id) // userId 없음 (공유)
  // video.description이 빈 문자열('')이면 ??가 통과시켜 getTranscript가 가져온 설명을 못 씀 → trim 검사
  const desc = video.description?.trim() ? video.description : description
  const result = await summarizeVideo(null, video.title, transcript, desc)
  // 일시적 실패(429/자막 실패 등)는 가짜 성공 객체로 돌아온다. 이걸 저장하면
  // 실패 문구가 공유 풀에 영구 캐시되어 모든 사용자가 영원히 실패본을 받는다.
  // → 저장하지 않으면 다음 주기/발송 폴백에서 자동 재시도됨.
  if (result.errorInfo || result.summaryBasis === '요약 실패') {
    console.error(`❌ 요약 실패 → 저장 생략, 재시도 대기 (${video.video_id}): ${result.errorInfo ?? result.summaryBasis}`)
    return false
  }
  const { error } = await supabase.from('video_summaries').upsert(
    {
      video_id: video.video_id,
      summary: result.summary,
      key_points: asArray(result.keyPoints), // JSONB 배열로 정규화
      timeline: asArray(result.timeline), // JSONB 배열로 정규화
      model: result.model ?? null,
    },
    { onConflict: 'video_id' }
  )
  if (error) {
    console.error(`❌ video_summaries 적재 실패 (${video.video_id}): ${error.message}`)
    return false
  }
  return true
}

// 미요약 영상 요약 → video_summaries 적재 (영상당 1번, 전역 공유). 요약한 개수 반환.
// deadlineTs(ms): 이 시각을 넘으면 다음 배치를 시작하지 않음 (60초 budget 보호).
export async function summarizePendingVideos(deadlineTs?: number): Promise<number> {
  const pending = await getVideosWithoutSummary()
  console.log(`🤖 요약 대기: ${pending.length}개 (이번 실행 최대 ${SUMMARY_LIMIT}개)`)
  if (!pending.length) return 0

  let done = 0
  for (let i = 0; i < pending.length; i += SUMMARY_CONCURRENCY) {
    if (deadlineTs && Date.now() > deadlineTs) {
      console.log(`⏱ 요약 시간 budget 도달 → 나머지는 다음 주기/발송 폴백으로 이월`)
      break
    }
    const batch = pending.slice(i, i + SUMMARY_CONCURRENCY)
    await Promise.allSettled(batch.map(async v => { if (await summarizeAndStore(v)) done++ }))
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
}

export type PoolSummary = {
  video_id: string
  summary: string | null
  key_points: string[] | null
  timeline: { time: string; content: string }[] | null
  model: string | null
}

// 채널들의 특정 기간(UTC) 영상 (쇼츠 제외, 공유 풀)
export async function getVideosFromPool(channelIds: string[], start: Date, end: Date): Promise<PoolVideo[]> {
  if (!channelIds.length) return []
  const { data } = await supabase
    .from('videos')
    .select('video_id, channel_id, title, published_at, duration_seconds, is_short, description')
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
export async function getSummariesFromPool(videoIds: string[]): Promise<Map<string, PoolSummary>> {
  const map = new Map<string, PoolSummary>()
  if (!videoIds.length) return map
  const { data } = await supabase
    .from('video_summaries')
    .select('video_id, summary, key_points, timeline, model')
    .in('video_id', videoIds)
  for (const s of (data ?? []) as PoolSummary[]) map.set(s.video_id, s)
  return map
}

// 단일 영상 요약 조회 (속보 폴백용)
export async function getSummary(videoId: string): Promise<PoolSummary | null> {
  const { data } = await supabase
    .from('video_summaries')
    .select('video_id, summary, key_points, timeline, model')
    .eq('video_id', videoId)
    .maybeSingle()
  return (data as PoolSummary) ?? null
}

// 폴백 C: 풀에 요약이 없는 영상을 즉시 요약 (videos에 있는 영상 대상). 요약한 개수 반환.
export async function summarizeNow(videoIds: string[]): Promise<number> {
  if (!videoIds.length) return 0
  const { data } = await supabase
    .from('videos')
    .select('video_id, title, description')
    .in('video_id', videoIds)
  const targets = (data ?? []) as PendingVideo[]
  if (!targets.length) return 0

  let done = 0
  await processInBatches(targets, SUMMARY_CONCURRENCY, async (video) => {
    if (await summarizeAndStore(video)) done++
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
