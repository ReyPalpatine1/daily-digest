import { logApiUsage } from '@/lib/api-usage'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
// -latest alias는 실험 모델(프로덕션 부적합, 엄격한 rate limit, 가용성 미보장)이라
// 503이 잦다 → 안정(GA) 모델 고정 + 503 시 폴백 모델로 1회 재시도.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-2.5-flash'

// 외부 API 무한 대기 방지
const SUPADATA_TIMEOUT_MS = 15000
const YOUTUBE_HTML_TIMEOUT_MS = 8000
const GEMINI_TIMEOUT_MS = 30000

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

export type SummaryResult = {
  summary: string
  keyPoints: string[]
  timeline: { time: string; content: string }[]
  summaryBasis: string // 요약 기반 표시
  model?: string // 요약에 사용한 모델명
  errorInfo?: string
  attempts?: number
}

export async function summarizeVideo(
  userId: string | null,
  title: string,
  transcript: string,
  description?: string
): Promise<SummaryResult> {
  const fnStart = Date.now()

  // 요약 기반 콘텐츠 구성 (모델과 무관 → 1회만 계산)
  let content = ''
  let summaryBasis = ''
  if (transcript && transcript.length > 50) {
    content = `자막:\n${transcript.slice(0, 8000)}`
    summaryBasis = '자동 생성 자막 기반 요약'
  } else if (description && description.length > 20) {
    content = `영상 설명:\n${description.slice(0, 2000)}`
    summaryBasis = '영상 설명 기반 요약'
  } else {
    content = ''
    summaryBasis = '제목 기반 요약'
  }

  const prompt = `다음은 유튜브 영상의 정보입니다.

제목: ${title}

${content || '(자막 및 설명 없음)'}

아래 JSON 형식으로만 응답해주세요. 다른 텍스트 없이 완전한 JSON만 반환하세요:
{
  "summary": "영상 전체 내용을 3~5문장으로 요약",
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "timeline": [{"time": "0:00", "content": "구간 내용 요약"}]
}

참고: 자막이 없으면 timeline은 빈 배열 []로 하세요. 응답은 유효한 JSON이어야 합니다.`

  // 시도 순서: 기본 모델(재시도 2회) → 503 지속이면 폴백 모델 1회.
  const plan: { model: string; maxRetries: number }[] = [
    { model: GEMINI_MODEL, maxRetries: 2 },
    { model: GEMINI_FALLBACK_MODEL, maxRetries: 1 },
  ]

  let lastResult: SummaryResult | null = null
  for (let i = 0; i < plan.length; i++) {
    const { model, maxRetries } = plan[i]
    const outcome = await callGeminiModel(model, prompt, summaryBasis, title, userId, maxRetries, fnStart)
    // 성공이든 비-503 실패(파싱/429/기타)든 종결 → 그대로 반환
    if (outcome.kind === 'done') return outcome.result
    // 503 지속 → 폴백 모델로 전환 (마지막이면 이 실패 객체를 반환)
    lastResult = outcome.result
    if (i < plan.length - 1) {
      console.log(`⚠️ ${model} 503 지속 → 폴백 모델(${plan[i + 1].model})로 전환`)
    }
  }

  // 폴백까지 503 → 마지막 실패 객체 반환 (저장 금지 로직이 errorInfo로 걸러냄)
  return lastResult ?? failureResult(GEMINI_FALLBACK_MODEL, '알 수 없는 오류', 0)
}

// 실패 시 반환하는 가짜 성공 객체 (errorInfo·summaryBasis로 저장 단계에서 걸러짐).
function failureResult(model: string, errorInfo: string, attempts: number): SummaryResult {
  return {
    summary: '요약을 가져오지 못했습니다.',
    keyPoints: [],
    timeline: [],
    summaryBasis: '요약 실패',
    model,
    errorInfo,
    attempts,
  }
}

type ModelOutcome =
  | { kind: 'done'; result: SummaryResult } // 성공 또는 비-503 종결 실패
  | { kind: 'unavailable503'; result: SummaryResult } // 503 재시도 소진 → 폴백 모델 시도 신호

// 단일 모델로 요약 시도 (maxRetries만큼 503/429 재시도). 503 소진 시 폴백 신호 반환.
async function callGeminiModel(
  model: string,
  prompt: string,
  summaryBasis: string,
  title: string,
  userId: string | null,
  maxRetries: number,
  fnStart: number
): Promise<ModelOutcome> {
  const retryDelay = 2000 // 2초

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const callStart = Date.now()
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // responseMimeType로 유효한 JSON만 반환하도록 강제 (따옴표 없는 값 등 깨진 JSON 방지)
            generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
          }),
        },
        GEMINI_TIMEOUT_MS
      )
      console.log(`⏱ [gemini fetch] ${Date.now() - callStart}ms (model=${model}, status=${res.status}, attempt=${attempt})`)

      if (res.status === 503) {
        if (attempt < maxRetries) {
          console.log(`⚠️ Gemini 503 에러, ${retryDelay}ms 후 재시도 (${model} ${attempt}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          continue
        }
        console.log(`❌ Gemini 503 에러, ${model} 최대 재시도 횟수 초과`)
        return { kind: 'unavailable503', result: failureResult(model, '503 Service Unavailable after retries', attempt) }
      }

      if (res.status === 429) {
        // Tier 1에선 거의 없지만, 만약 발생 시 retryDelay 또는 응답의 retryDelay 만큼 대기
        let waitMs = retryDelay
        try {
          const errData = await res.clone().json()
          const retryInfo = errData?.error?.details?.find(
            (d: any) => d['@type']?.includes('RetryInfo')
          )
          const retryDelayStr: string | undefined = retryInfo?.retryDelay
          if (retryDelayStr) {
            const sec = parseInt(retryDelayStr.replace(/[^0-9]/g, ''), 10)
            if (!isNaN(sec) && sec > 0) waitMs = sec * 1000
          }
        } catch {}
        if (attempt < maxRetries) {
          console.log(`⚠️ Gemini 429 에러, ${waitMs}ms 후 재시도 (${model} ${attempt}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, waitMs))
          continue
        }
        console.log(`❌ Gemini 429 에러, ${model} 최대 재시도 횟수 초과`)
        return { kind: 'done', result: failureResult(model, '429 Too Many Requests after retries', attempt) }
      }

      let data
      try {
        data = await res.json()
      } catch (jsonError) {
        console.log('❌ Gemini API 응답 JSON 파싱 실패:', jsonError)
        throw new Error(`API 응답 파싱 실패: ${jsonError}`)
      }
      if (data.error) {
        console.log('❌ Gemini API 에러:', JSON.stringify(data.error))
        throw new Error(data.error.message)
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      console.log('🔍 Gemini 원본 응답 길이:', text.length)
      console.log('🔍 Gemini 원본 응답 끝부분:', text.slice(-100))
      if (!text) {
        console.log('❌ Gemini 응답 비어있음:', JSON.stringify(data))
        throw new Error('빈 응답')
      }
      const clean = text.replace(/```json|```/g, '').trim()
      console.log('📝 Gemini 정리 후 응답 일부:', clean.slice(0, 200))

      const usage = data.usageMetadata ?? {}
      const inputTokens = usage.promptTokenCount ?? 0
      const outputTokens = usage.candidatesTokenCount ?? 0
      // fire-and-forget: 사용량 기록 실패가 핵심 경로를 막지 않도록
      // userId가 없으면(공유 수집 등) 특정 사용자 귀속이 없으므로 기록 생략
      if (userId) {
        logApiUsage(userId, 'gemini', inputTokens, outputTokens).catch(e =>
          console.error('[gemini] logApiUsage 실패:', e)
        )
      }

      // JSON 파싱 시도
      let parsed
      try {
        parsed = JSON.parse(clean)
      } catch (parseError) {
        console.log('❌ JSON 파싱 실패, 기본값 반환:', parseError)
        // 파싱 실패시 기본 요약 반환 (종결: 폴백해도 결과 동일)
        return {
          kind: 'done',
          result: {
            summary: `영상 요약을 생성할 수 없습니다: ${title}`,
            keyPoints: ['요약 생성 실패'],
            timeline: [],
            summaryBasis: '요약 실패',
            model,
            errorInfo: `JSON 파싱 오류: ${parseError}`,
            attempts: attempt,
          },
        }
      }

      console.log(`⏱ [summarizeVideo total] ${Date.now() - fnStart}ms (model=${model}, basis=${summaryBasis})`)
      return { kind: 'done', result: { ...parsed, summaryBasis, model, attempts: attempt } }
    } catch (e) {
      const errorInfo = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
      const isRetryable = errorInfo.includes('503') || errorInfo.includes('429')
      if (attempt === maxRetries || !isRetryable) {
        console.log('❌ Gemini 요약 에러:', e)
        // 503이 throw로 흘러온 경우엔 폴백 신호로, 그 외엔 종결 실패로 처리
        const kind = errorInfo.includes('503') ? 'unavailable503' : 'done'
        return { kind, result: failureResult(model, errorInfo, attempt) }
      }
      // 503/429 에러는 재시도
    }
  }

  // 루프 정상 종료(도달하지 않음) — 안전하게 폴백 신호
  return { kind: 'unavailable503', result: failureResult(model, '알 수 없는 오류', maxRetries) }
}

export async function getTranscript(videoId: string, userId?: string): Promise<{ transcript: string; description: string }> {
  const fnStart = Date.now()
  let transcript = ''
  let description = ''

  // Supadata API로 자막 추출 (timeout 적용)
  const supadataStart = Date.now()
  try {
    // lang 없이 1회만 호출 (기본 언어 자막 사용). 실패(206 등)해도 1크레딧이 차감되므로
    // 과거의 ko→기본언어 2단계 호출(자막 없는 영상마다 2크레딧 소모)을 제거.
    const res = await fetchWithTimeout(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=true`,
      { headers: { 'x-api-key': process.env.SUPADATA_API_KEY! } },
      SUPADATA_TIMEOUT_MS
    )
    if (userId) {
      logApiUsage(userId, 'supadata').catch(e => console.error('[supadata] logApiUsage 실패:', e))
    }

    if (res.ok) {
      const data = await res.json()
      transcript = data.content ?? ''
      console.log(`✅ Supadata 자막 추출 성공: ${videoId} (${Date.now() - supadataStart}ms)`)
    } else {
      // 실패 시 추가 호출 없이 바로 설명/제목 폴백으로 진행 (status 코드로 크레딧 소모 추적)
      console.log(`❌ Supadata 자막 없음: ${videoId} (status=${res.status}, ${Date.now() - supadataStart}ms)`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`❌ Supadata 에러/timeout: ${videoId} (${Date.now() - supadataStart}ms) — ${msg}`)
  }

  // 영상 설명 추출 시도 (timeout 적용)
  const descStart = Date.now()
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      },
      YOUTUBE_HTML_TIMEOUT_MS
    )
    const html = await res.text()
    const descMatch = html.match(/"shortDescription":"(.*?)"(?:,"isCrawlable")/)
    if (descMatch) {
      description = descMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .slice(0, 2000)
    }
    console.log(`⏱ [yt html] ${videoId} (${Date.now() - descStart}ms, descLen=${description.length})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`❌ 설명 추출 실패/timeout: ${videoId} (${Date.now() - descStart}ms) — ${msg}`)
  }

  console.log(`⏱ [getTranscript total] ${videoId} ${Date.now() - fnStart}ms (transcriptLen=${transcript.length})`)
  return { transcript, description }
}