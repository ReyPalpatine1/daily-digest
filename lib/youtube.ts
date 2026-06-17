import { logApiUsage, SYSTEM_USER_ID } from './api-usage'

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!

// 발송/풀에서 공통으로 쓰는 영상 표현 (mailer 등에서 import)
export type VideoItem = {
  videoId: string
  title: string
  publishedAt: string
  channelTitle: string
  url: string
}

// 채널 ID 추출 (URL에서). 채널 행에 channel_id가 없을 때 1회 보정용.
export async function getChannelId(channelUrl: string, userId?: string): Promise<string | null> {
  try {
    const handle = channelUrl.split('@')[1]?.split('/')[0]
    if (!handle) return null

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${handle}&key=${YOUTUBE_API_KEY}`
    )
    // userId가 없으면(공유 수집 등) 시스템 계정으로 귀속해 항상 기록
    await logApiUsage(userId ?? SYSTEM_USER_ID, 'youtube')
    const data = await res.json()
    return data.items?.[0]?.snippet?.channelId ?? null
  } catch {
    return null
  }
}

// 4d 정리: 사용자별 즉시 수집 경로(getYesterdayVideos/getRecentVideos/getLatestVideo)는
// 공유 풀(lib/video-pool.ts) 기반으로 전환되어 제거됨. 수집은 playlistItems 기반으로 통일.
