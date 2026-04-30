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

function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0

  const hours = Number(match[1] ?? '0')
  const minutes = Number(match[2] ?? '0')
  const seconds = Number(match[3] ?? '0')
  return hours * 3600 + minutes * 60 + seconds
}

function isShortsVideo(video: any): boolean {
  const title = video.snippet?.title ?? ''
  const description = video.snippet?.description ?? ''
  const duration = parseDurationToSeconds(video.contentDetails?.duration ?? '')

  const hasShortsTag = /#shorts/i.test(title) || /#shorts/i.test(description)
  const isShortDuration = duration > 0 && duration <= 60

  return hasShortsTag || isShortDuration
}

// 전날 업로드된 영상 가져오기
export async function getYesterdayVideos(channelId: string): Promise<VideoItem[]> {
  try {
    const now = new Date()
    const todayKstMidnightUtc = getSeoulMidnightUtc(now)
    const yesterdayKstMidnightUtc = new Date(todayKstMidnightUtc.getTime() - 24 * 60 * 60 * 1000)

    const publishedAfter = yesterdayKstMidnightUtc.toISOString()
    const publishedBefore = todayKstMidnightUtc.toISOString()

    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}&maxResults=10&key=${YOUTUBE_API_KEY}`
    )
    const searchData = await searchRes.json()
    const items = searchData.items ?? []
    const videoIds = items
      .map((item: any) => item.id.videoId)
      .filter((id: string) => Boolean(id))

    if (!videoIds.length) {
      return []
    }

    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`
    )
    const videosData = await videosRes.json()

    return (videosData.items ?? [])
      .filter((video: any) => !isShortsVideo(video))
      .map((video: any) => ({
        videoId: video.id,
        title: video.snippet.title,
        publishedAt: video.snippet.publishedAt,
        channelTitle: video.snippet.channelTitle,
        url: `https://youtube.com/watch?v=${video.id}`,
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