import { NextRequest, NextResponse } from 'next/server'
import { YoutubeTranscript } from 'youtube-transcript'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const { searchParams } = new URL(req.url)

  if (!cronSecret || searchParams.get('secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const videoId = searchParams.get('videoId') ?? 'dQw4w9WgXcQ'

  // 1) youtube-transcript 시도
  let transcriptResult: object
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId)
    transcriptResult = {
      ok: true,
      count: items.length,
      sample: items.slice(0, 3).map((i) => i.text).join(' ').slice(0, 200),
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e))
    transcriptResult = {
      ok: false,
      errorName: err.name,
      errorMessage: String(err.message).slice(0, 300),
    }
  }

  // 2) watch 페이지 차단 여부 직접 확인
  let watchDiag: object
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    })
    const html = await res.text()
    const lower = html.toLowerCase()
    const looksBlocked =
      lower.includes('consent.youtube') ||
      lower.includes('before you continue') ||
      lower.includes('sign in to confirm')
    watchDiag = {
      status: res.status,
      htmlLen: html.length,
      looksBlocked,
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e))
    watchDiag = {
      error: String(err.message).slice(0, 300),
    }
  }

  return NextResponse.json({ videoId, transcriptResult, watchDiag })
}
