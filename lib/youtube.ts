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

// 주소 해석 결과 — 채널 ID + (응답에 있으면) 채널 제목. 제목은 채널 이름 자동 입력에 쓴다.
export type ResolvedChannel = { channelId: string; title: string | null }

function channelFromItem(item: any): ResolvedChannel | null {
  const id = item?.id
  if (typeof id !== 'string' || !id) return null
  const title = item?.snippet?.title
  return { channelId: id, title: typeof title === 'string' && title.trim() ? title.trim() : null }
}

// @핸들 → 채널 (channels.list forHandle, 할당량 1). search API(할당량 100·부정확)는 쓰지 않는다.
async function channelByHandle(handle: string, userId?: string): Promise<ResolvedChannel | null> {
  const clean = handle.replace(/^@/, '')
  if (!clean) return null
  const data = await youtubeApiGet(
    `channels?part=id,snippet&forHandle=${encodeURIComponent('@' + clean)}`, userId)
  return channelFromItem(data?.items?.[0])
}

// 레거시 /user/이름 → 채널 (channels.list forUsername, 할당량 1).
async function channelByUsername(username: string, userId?: string): Promise<ResolvedChannel | null> {
  const data = await youtubeApiGet(
    `channels?part=id,snippet&forUsername=${encodeURIComponent(username)}`, userId)
  return channelFromItem(data?.items?.[0])
}

// 채널 ID → 채널 제목 (channels.list id, 할당량 1). /channel/UC... 주소를 이름 없이 추가할 때만 쓴다.
export async function channelTitleById(channelId: string, userId?: string): Promise<string | null> {
  const data = await youtubeApiGet(`channels?part=snippet&id=${encodeURIComponent(channelId)}`, userId)
  return channelFromItem(data?.items?.[0])?.title ?? null
}

// 영상 ID → 그 영상의 채널 (videos.list, 할당량 1). 제목은 snippet.channelTitle.
async function channelByVideo(videoId: string, userId?: string): Promise<ResolvedChannel | null> {
  const data = await youtubeApiGet(`videos?part=snippet&id=${encodeURIComponent(videoId)}`, userId)
  const sn = data?.items?.[0]?.snippet
  const id = sn?.channelId
  if (typeof id !== 'string' || !id) return null
  const title = typeof sn?.channelTitle === 'string' && sn.channelTitle.trim() ? sn.channelTitle.trim() : null
  return { channelId: id, title }
}

const CHANNEL_ID_RE = /^UC[\w-]{22}$/
const VIDEO_ID_RE = /^[\w-]{11}$/

function safeDecode(v: string): string {
  try { return decodeURIComponent(v) } catch { return v }
}

// 채널 추가 입력 주소 → 채널(ID + 응답에 있던 제목). 해석 못 하면 null(호출부는 채널을 만들지 않는다).
//  ① youtube.com/channel/UC...           → 그대로(API 호출 없음, 제목 null)
//  ② youtube.com/@핸들(/videos 등)        → channels.list forHandle
//  ③ watch?v= / youtu.be / shorts / live → videos.list 의 snippet.channelId·channelTitle
//  ④ /user/이름 → channels.list forUsername, /c/이름 → 같은 이름의 핸들로 forHandle 시도
//  (m.youtube.com·music.youtube.com 포함, 프로토콜 없는 입력·"@핸들"·"UC..." 단독 입력도 허용)
export async function resolveChannel(input: string, userId?: string): Promise<ResolvedChannel | null> {
  const raw = (input ?? '').trim()
  if (!raw) return null
  if (CHANNEL_ID_RE.test(raw)) return { channelId: raw, title: null }
  if (raw.startsWith('@')) return channelByHandle(safeDecode(raw.slice(1).split(/[/?#]/)[0]), userId)

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
    return id && VIDEO_ID_RE.test(id) ? channelByVideo(id, userId) : null
  }
  if (host !== 'youtube.com') return null

  const [first, second] = parts
  if (!first) return null
  if (first === 'channel') return second && CHANNEL_ID_RE.test(second) ? { channelId: second, title: null } : null
  if (first.startsWith('@')) return channelByHandle(first.slice(1), userId)
  if (first === 'watch') {
    const v = u.searchParams.get('v')
    return v && VIDEO_ID_RE.test(v) ? channelByVideo(v, userId) : null
  }
  if (first === 'shorts' || first === 'live' || first === 'embed') {
    return second && VIDEO_ID_RE.test(second) ? channelByVideo(second, userId) : null
  }
  if (first === 'user') return second ? channelByUsername(second, userId) : null
  if (first === 'c') return second ? channelByHandle(second, userId) : null
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
  return (await channelByHandle(safeDecode(handle), userId))?.channelId ?? null
}

// 4d 정리: 사용자별 즉시 수집 경로(getYesterdayVideos/getRecentVideos/getLatestVideo)는
// 공유 풀(lib/video-pool.ts) 기반으로 전환되어 제거됨. 수집은 playlistItems 기반으로 통일.
