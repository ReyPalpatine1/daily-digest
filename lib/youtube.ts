import { logApiUsage, SYSTEM_USER_ID } from './api-usage'

// 발송/풀에서 공통으로 쓰는 영상 표현 (mailer 등에서 import)
export type VideoItem = {
  videoId: string
  title: string
  publishedAt: string
  channelTitle: string
  url: string
}

// YouTube Data API 공용 GET — 호출마다 api_usage 기록(userId 없으면 시스템 계정 귀속).
// Cloudflare 호환: env는 함수 내부에서 읽는다. 키 없음·네트워크 오류·비정상 응답이면 null.
async function youtubeApiGet(path: string, userId?: string): Promise<any | null> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${key}`)
    await logApiUsage(userId ?? SYSTEM_USER_ID, 'youtube')
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// @핸들 → 채널 ID (channels.list forHandle, 할당량 1). search API(할당량 100·부정확)는 쓰지 않는다.
async function channelIdByHandle(handle: string, userId?: string): Promise<string | null> {
  const clean = handle.replace(/^@/, '')
  if (!clean) return null
  const data = await youtubeApiGet(
    `channels?part=id,snippet&forHandle=${encodeURIComponent('@' + clean)}`, userId)
  return data?.items?.[0]?.id ?? null
}

// 레거시 /user/이름 → 채널 ID (channels.list forUsername, 할당량 1).
async function channelIdByUsername(username: string, userId?: string): Promise<string | null> {
  const data = await youtubeApiGet(
    `channels?part=id&forUsername=${encodeURIComponent(username)}`, userId)
  return data?.items?.[0]?.id ?? null
}

// 영상 ID → 그 영상의 채널 ID (videos.list, 할당량 1).
async function channelIdByVideo(videoId: string, userId?: string): Promise<string | null> {
  const data = await youtubeApiGet(`videos?part=snippet&id=${encodeURIComponent(videoId)}`, userId)
  return data?.items?.[0]?.snippet?.channelId ?? null
}

const CHANNEL_ID_RE = /^UC[\w-]{22}$/
const VIDEO_ID_RE = /^[\w-]{11}$/

function safeDecode(v: string): string {
  try { return decodeURIComponent(v) } catch { return v }
}

// 채널 추가 입력 주소 → 채널 ID. 해석 못 하면 null(호출부는 채널을 만들지 않는다).
//  ① youtube.com/channel/UC...           → 그대로(API 호출 없음)
//  ② youtube.com/@핸들(/videos 등)        → channels.list forHandle
//  ③ watch?v= / youtu.be / shorts / live → videos.list 의 snippet.channelId
//  ④ /user/이름 → channels.list forUsername, /c/이름 → 같은 이름의 핸들로 forHandle 시도
//  (m.youtube.com·music.youtube.com 포함, 프로토콜 없는 입력·"@핸들"·"UC..." 단독 입력도 허용)
export async function resolveChannelId(input: string, userId?: string): Promise<string | null> {
  const raw = (input ?? '').trim()
  if (!raw) return null
  if (CHANNEL_ID_RE.test(raw)) return raw
  if (raw.startsWith('@')) return channelIdByHandle(safeDecode(raw.slice(1).split(/[/?#]/)[0]), userId)

  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  const parts = u.pathname.split('/').filter(Boolean).map(safeDecode)

  if (host === 'youtu.be') {
    const id = parts[0]
    return id && VIDEO_ID_RE.test(id) ? channelIdByVideo(id, userId) : null
  }
  if (host !== 'youtube.com') return null

  const [first, second] = parts
  if (!first) return null
  if (first === 'channel') return second && CHANNEL_ID_RE.test(second) ? second : null
  if (first.startsWith('@')) return channelIdByHandle(first.slice(1), userId)
  if (first === 'watch') {
    const v = u.searchParams.get('v')
    return v && VIDEO_ID_RE.test(v) ? channelIdByVideo(v, userId) : null
  }
  if (first === 'shorts' || first === 'live' || first === 'embed') {
    return second && VIDEO_ID_RE.test(second) ? channelIdByVideo(second, userId) : null
  }
  if (first === 'user') return second ? channelIdByUsername(second, userId) : null
  if (first === 'c') return second ? channelIdByHandle(second, userId) : null
  return null
}

// 정식 채널 주소 — 채널 행 url에 이 형태로 저장한다.
export function canonicalChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`
}

// 채널 행에 channel_id가 없을 때 1회 보정용(digest·breaking·preview).
// 기존과 같이 @핸들 주소만 대상으로 하되, search API 대신 forHandle(할당량 1)로 찾는다.
// (영상 주소 등으로 잘못 저장된 기존 행은 여기서 자동 수정하지 않는다)
export async function getChannelId(channelUrl: string, userId?: string): Promise<string | null> {
  const handle = channelUrl.split('@')[1]?.split(/[/?#]/)[0]
  if (!handle) return null
  return channelIdByHandle(safeDecode(handle), userId)
}

// 4d 정리: 사용자별 즉시 수집 경로(getYesterdayVideos/getRecentVideos/getLatestVideo)는
// 공유 풀(lib/video-pool.ts) 기반으로 전환되어 제거됨. 수집은 playlistItems 기반으로 통일.
