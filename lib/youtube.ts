const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!

export type VideoItem = {
  videoId: string
  title: string
  publishedAt: string
  channelTitle: string
  url: string
}

// 채널 ID 추출 (URL에서)
export async function getChannelId(channelUrl: string): Promise<string | null> {
  try {
    const handle = channelUrl.split('@')[1]?.split('/')[0]
    if (!handle) return null

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${handle}&key=${YOUTUBE_API_KEY}`
    )
    const data = await res.json()
    return data.items?.[0]?.snippet?.channelId ?? null
  } catch {
    return null
  }
}

function getSeoulMidnightUtc(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const map = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  ) as Record<string, string>

  return new Date(
    Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      0,
      0,
      0
    )
  )
}

// 전날 업로드된 영상 가져오기
export async function getYesterdayVideos(channelId: string): Promise<VideoItem[]> {
  try {
    const now = new Date()
    const todayKstMidnightUtc = getSeoulMidnightUtc(now)
    const yesterdayKstMidnightUtc = new Date(todayKstMidnightUtc.getTime() - 24 * 60 * 60 * 1000)

    const publishedAfter = yesterdayKstMidnightUtc.toISOString()
    const publishedBefore = todayKstMidnightUtc.toISOString()

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}&maxResults=10&key=${YOUTUBE_API_KEY}`
    )
    const data = await res.json()

    return (data.items ?? []).map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      channelTitle: item.snippet.channelTitle,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
    }))
  } catch {
    return []
  }
}

// 최신 영상 실시간 감지 (속보용)
export async function getLatestVideo(channelId: string): Promise<VideoItem | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=1&key=${YOUTUBE_API_KEY}`
    )
    const data = await res.json()
    const item = data.items?.[0]
    if (!item) return null

    return {
      videoId: item.id.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      channelTitle: item.snippet.channelTitle,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
    }
  } catch {
    return null
  }
}