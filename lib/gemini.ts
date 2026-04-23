const GEMINI_API_KEY = process.env.GEMINI_API_KEY!

export type SummaryResult = {
  summary: string
  keyPoints: string[]
  timeline: { time: string; content: string }[]
}

export async function summarizeVideo(
  title: string,
  transcript: string,
  description?: string
): Promise<SummaryResult> {
  try {
    const content = transcript
      ? `자막:\n${transcript.slice(0, 8000)}`
      : `영상 설명:\n${(description ?? '').slice(0, 2000)}`

    const prompt = `
다음은 유튜브 영상의 정보입니다.

제목: ${title}

${content}

아래 JSON 형식으로만 응답해주세요. 다른 텍스트 없이 JSON만:
{
  "summary": "영상 전체 내용을 3~5문장으로 요약 (자막이나 설명이 없으면 제목 기반으로 추정해서 작성)",
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "timeline": [
    { "time": "0:00", "content": "해당 구간 내용 요약" }
  ]
}

참고: 자막이 없으면 timeline은 빈 배열로 반환하세요.
`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
      }
    )

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      summary: '요약을 가져오지 못했습니다.',
      keyPoints: [],
      timeline: [],
    }
  }
}

export async function getTranscript(videoId: string): Promise<{ transcript: string; description: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      }
    })
    const html = await res.text()

    // 영상 설명 추출
    let description = ''
    const descMatch = html.match(/"shortDescription":"(.*?)"(?:,"isCrawlable")/)
    if (descMatch) {
      description = descMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .slice(0, 2000)
    }

    // 자막 추출 시도
    const match = html.match(/"captionTracks":\[(.*?)\]/)
    if (!match) return { transcript: '', description }

    const captionData = JSON.parse(`[${match[1]}]`)

    // 한국어 자막 우선, 없으면 자동생성 자막, 없으면 첫번째
    const track =
      captionData.find((t: any) => t.languageCode === 'ko') ??
      captionData.find((t: any) => t.kind === 'asr') ??
      captionData[0]

    if (!track?.baseUrl) return { transcript: '', description }

    const captionRes = await fetch(track.baseUrl)
    const xml = await captionRes.text()

    const transcript = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()

    return { transcript, description }
  } catch {
    return { transcript: '', description: '' }
  }
}