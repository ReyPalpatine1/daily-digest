import { logApiUsage, SYSTEM_USER_ID } from '@/lib/api-usage'
import type { Locale } from './i18n/translations'

// Cloudflare 호환: process.env는 요청 처리 시점에 채워지므로 모듈 최상단에서 읽지 않고
// 호출 함수 내부에서 읽는다. (다른 파일과 동일 패턴)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!
// -latest alias는 실험 모델(프로덕션 부적합, 엄격한 rate limit, 가용성 미보장)이라
// 503이 잦다 → 안정(GA) 모델 고정 + 503 시 폴백 모델로 1회 재시도.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-2.5-flash'

// 외부 API 무한 대기 방지
const TRANSCRIPTAPI_TIMEOUT_MS = 15000
const SUPADATA_TIMEOUT_MS = 15000
const YOUTUBE_HTML_TIMEOUT_MS = 8000
const GEMINI_TIMEOUT_MS = 30000

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

export type SummaryResult = {
  // 한 줄 요약 (품질 평가용, UI 미노출). gemini 생산 경로는 항상 문자열을 채우지만,
  // DB에서 요약을 재구성해 발송하는 경로(breaking/digest route)는 tldr을 싣지 않으므로 옵셔널.
  tldr?: string
  summary: string
  keyPoints: string[]
  timeline: { time: string; content: string }[]
  summaryBasis: string // 요약 기반 표시
  model?: string // 요약에 사용한 모델명
  errorInfo?: string
  attempts?: number
  failReason?: string // 실패 사유 코드 (no_source: 자막·설명 없음 → Gemini 미호출. 그 외 실패는 temporary로 간주)
  failDetail?: string // 관리자 디버그용 세부 사유 (발송 경로에서 채워 전달)
}

// 깨진 JSON 복구용: 첫 '{'부터 중괄호 깊이를 세어 깊이가 0이 되는 지점까지 잘라낸다.
// 문자열 리터럴 내부의 중괄호와 이스케이프된 따옴표는 무시 (예: 끝에 '}'가 덧붙은 응답).
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
  zh: '중국어 간체',
  ja: '일본어',
}

export async function summarizeVideo(
  userId: string | null,
  title: string,
  transcript: string,
  description?: string,
  locale: Locale = 'ko'
): Promise<SummaryResult> {
  const fnStart = Date.now()

  // 요약 기반 콘텐츠 구성 (모델과 무관 → 1회만 계산)
  // summary/keyPoints/timeline이 같은 내용을 반복하지 않도록 역할 분리 지침 사용.
  let content = ''
  let summaryBasis = ''
  let lengthGuide = ''
  if (transcript && transcript.length > 50) {
    content = `자막:\n${transcript.slice(0, 45000)}`
    summaryBasis = '자동 생성 자막 기반 요약'
    lengthGuide = `세 요소는 서로 다른 역할을 하며 같은 내용을 반복하지 말 것:
  · summary: 영상의 전체 맥락과 흐름을 2~3문장으로 개괄. '무슨 영상이고 무엇을 다루는지' 파악용. 세부 수치·고유명사·구체적 결론은 여기 넣지 말 것(그건 keyPoints 담당). 문단이 나뉘면 문단 사이는 빈 줄(\\n\\n).
  · keyPoints: summary에서 다루지 않은 구체적 디테일 5개 — 숫자, 고유명사, 핵심 주장·조언·결론 등 '팩트' 위주. 각 항목은 '핵심 내용 — 한 문장 부연'. summary 문장을 그대로 반복하지 말 것.
  · timeline: 영상의 어느 지점에서 무슨 주제가 나오는지 '위치 안내'. 각 content는 그 구간의 주제를 짧은 명사구로(내용 서술을 길게 하지 말 것 — 그건 summary/keyPoints 담당). 제공된 자막의 [m:ss] 실제 시간 앵커만 time에 사용하고 존재하지 않는 시간을 추정·창작하지 말 것. 앵커 없으면 timeline은 빈 배열 []. 영상 흐름상 의미 있는 구간 4~6개, 각 항목의 time은 그 내용이 시작되는 가장 가까운 앵커 시각.`
  } else if (description && description.length > 20) {
    content = `영상 설명:\n${description.slice(0, 2000)}`
    summaryBasis = '영상 설명 기반 요약'
    lengthGuide = "summary는 맥락 2~3문장 개괄. keyPoints는 3~4개 구체 디테일 위주('핵심 내용 — 부연'). summary와 중복 금지. timeline은 빈 배열 []."
  } else {
    // 자막·설명 모두 없음 → 제목만으로는 요약하지 않는다 (환각 위험). Gemini 미호출 즉시 실패.
    console.log(`❌ 자막·설명 없음 → 요약 불가 (no_source): ${title}`)
    return { ...failureResult(GEMINI_MODEL, '자막·설명 없음 (no_source)', 0), failReason: 'no_source' }
  }

  const langInstruction = locale !== 'ko'
    ? `\n- 다음 언어로 요약: ${LOCALE_LANGUAGE_NAMES[locale]} (summary, keyPoints, timeline 모두 해당 언어로 작성)`
    : ''

  const prompt = `다음은 유튜브 영상의 정보입니다.

제목: ${title}
${content || '(자막 및 설명 없음)'}

[요약 지침]
- 위 제공된 정보(제목/자막/설명)에 실제로 담긴 내용만 사용하세요.
- 제공되지 않은 수치, 통계, 인용, 사실을 절대 지어내지 마세요. 정보가 부족하면 무리해서 길게 쓰지 말고 아는 만큼만 쓰세요.
- 구체적으로: 자막/설명에 등장하는 고유명사, 수치, 핵심 주장을 가능한 한 살려서 요약하세요.
- ${lengthGuide}${langInstruction}
- tldr은 "제목만 보고는 알 수 없는, 영상이 실제로 밝히는 핵심 답"을 한 문장으로(공백 포함 80자 이내). **제목이 이미 말한 주제·질문을 다시 언급하며 시작하지 말고, 곧바로 답·결론·수치부터 제시할 것.** 독자는 제목을 이미 봤으므로 배경 반복은 불필요하다. 제목/summary 첫 문장을 반복하지 말 것.
  · 나쁜 예(제목 "비규제지역 여기 대장 사세요"): "비규제지역 중에서도 동남권 대장급 아파트가 유망하며…" (앞부분이 제목 반복)
  · 좋은 예: "동남권 대장급 아파트가 가장 유망하고, 자금이 부족하면 경기 서·북부 저평가 대장주가 대안." (배경 없이 답부터)
  영상에 그런 구체적 답이 없으면 억지로 만들지 말고 가장 정보가치 높은 사실 한 가지를 답부터 제시. 다국어 요약 시 tldr도 해당 언어.

아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 완전한 JSON만 반환하세요:
{
  "tldr": "...",
  "summary": "...",
  "keyPoints": ["...", "..."],
  "timeline": [{"time": "0:00", "content": "..."}]
}

timeline의 time은 자막에 실제 등장한 [m:ss] 앵커 시각만 사용하세요. 응답은 반드시 유효한 JSON이어야 합니다.`

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
    tldr: '',
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

  // Cloudflare 호환: 요청 시점에 env를 읽는다.
  const apiKey = process.env.GEMINI_API_KEY!
  // GEMINI_BASE_URL이 있으면(Cloudflare) AI Gateway 경유로 지역 차단 우회,
  // 없으면(Vercel) 기존 직접 호출. 끝 슬래시 중복 방지.
  const base = (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const callStart = Date.now()
      const res = await fetchWithTimeout(
        `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // responseMimeType로 유효한 JSON만 반환하도록 강제 (따옴표 없는 값 등 깨진 JSON 방지)
            generationConfig: { temperature: 0.3, maxOutputTokens: 1500, responseMimeType: 'application/json' },
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
      // userId가 없으면(공유 수집 등) 시스템 계정으로 귀속해 항상 기록
      logApiUsage(userId ?? SYSTEM_USER_ID, 'gemini', inputTokens, outputTokens).catch(e =>
        console.error('[gemini] logApiUsage 실패:', e)
      )

      // JSON 파싱 시도
      let parsed
      try {
        parsed = JSON.parse(clean)
      } catch (parseError) {
        // 복구 1회 시도: 균형 잡힌 첫 객체만 잘라내 재파싱 (예: 끝에 '}'가 덧붙은 경우)
        const recovered = extractBalancedJson(clean)
        if (recovered) {
          try {
            parsed = JSON.parse(recovered)
            console.log(`⚠️ JSON 복구 파싱 성공 (원본 ${clean.length}자 → 복구 ${recovered.length}자)`)
          } catch { /* 복구도 실패 → 아래 실패 처리 */ }
        }
        if (parsed === undefined) {
          console.log('❌ JSON 파싱 실패, 기본값 반환:', parseError)
          // 파싱 실패시 기본 요약 반환 (종결: 폴백해도 결과 동일)
          return {
            kind: 'done',
            result: {
              tldr: '',
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
      }

      console.log(`⏱ [summarizeVideo total] ${Date.now() - fnStart}ms (model=${model}, basis=${summaryBasis})`)
      // tldr이 없거나 문자열이 아니면 '' 폴백 (timeline: [] 폴백과 동일한 방어)
      const tldr = typeof parsed.tldr === 'string' ? parsed.tldr : ''
      return { kind: 'done', result: { ...parsed, tldr, summaryBasis, model, attempts: attempt } }
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

export async function getTranscript(videoId: string, userId?: string): Promise<{
  transcript: string
  description: string
  unavailable: boolean
  transcriptExhausted?: boolean // 자막 API가 429/402(크레딧 소진) 응답 → "확정 아님"(충전/유료 전환 후 자막 가능)
  transcriptMissing?: boolean   // 자막 없음이 "확정"(콘텐츠 없음). 소진과 구분해 재시도 축소에 사용
}> {
  const fnStart = Date.now()
  let transcript = ''
  let description = ''
  let unavailable = false // 비공개/삭제 영상 (YouTube API items 비어있음)
  let transcriptExhausted = false // 429/402 = 크레딧 소진 (일시적, 재시도 여지 있음)
  let transcriptMissing = false   // 콘텐츠 없음 확정 (Supadata까지 확인해 자막 없음)
  // 크레딧 소진으로 볼 상태코드: 429(Too Many Requests) / 402(Payment Required)
  const isExhaustedStatus = (status: number) => status === 429 || status === 402

  // 1차: TranscriptAPI (자막 있는 영상은 싸게 — 성공 요청당 과금). 키가 없으면 통째로 건너뛰고
  // 기존 Supadata 흐름으로 진행(현행 동작 보존). Cloudflare 호환: env는 함수 내부에서 읽는다.
  const transcriptApiKey = process.env.TRANSCRIPTAPI_KEY
  if (transcriptApiKey) {
    const taStart = Date.now()
    try {
      // 세그먼트 배열(transcript)을 받아 시간 앵커([m:ss])와 함께 join → timeline 실측화에 사용.
      const res = await fetchWithTimeout(
        `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${videoId}&format=json&include_timestamp=true`,
        { headers: { Authorization: `Bearer ${transcriptApiKey}` } },
        TRANSCRIPTAPI_TIMEOUT_MS
      )
      if (res.ok) {
        const data = await res.json()
        const segments = Array.isArray(data?.transcript) ? data.transcript : []
        // 시간표시 붙은 자막 생성: 매 세그먼트마다 앵커를 붙이면 너무 촘촘하므로
        // 직전 앵커와 30초 이상 벌어질 때만 [m:ss] 삽입 (start는 초 단위 float).
        const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
        let lastMark = -999
        const text = segments.map((s: { text?: string; start?: number }) => {
          const t = (s?.text ?? '').trim()
          if (!t) return ''
          if (typeof s?.start === 'number' && s.start - lastMark >= 30) {
            lastMark = s.start
            return `[${fmtTime(s.start)}] ${t}`
          }
          return t
        }).filter(Boolean).join(' ').trim()
        if (text) {
          transcript = text
          // 성공 요청당 과금 → 성공 시에만 기록. userId 없으면 시스템 계정 귀속.
          logApiUsage(userId ?? SYSTEM_USER_ID, 'transcriptapi').catch(e => console.error('[transcriptapi] logApiUsage 실패:', e))
          console.log(`✅ TranscriptAPI 자막 추출 성공: ${videoId} (${Date.now() - taStart}ms)`)
        } else {
          console.log(`❌ TranscriptAPI 자막 비어있음: ${videoId} (${Date.now() - taStart}ms) → Supadata 폴백`)
        }
      } else if (isExhaustedStatus(res.status)) {
        // 크레딧 소진(429/402) → "확정 아님". Supadata(Whisper)로 폴백은 시도.
        transcriptExhausted = true
        console.log(`⛔ TranscriptAPI 크레딧 소진(status=${res.status}): ${videoId} → Supadata 폴백`)
      } else {
        // 자막없음(404 등) → 과금 없음. 단 자막 없음 "확정"은 Whisper까지 본 Supadata에서 판정.
        console.log(`❌ TranscriptAPI 자막 없음: ${videoId} (status=${res.status}, ${Date.now() - taStart}ms) → Supadata 폴백`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`❌ TranscriptAPI 에러/timeout: ${videoId} (${Date.now() - taStart}ms) — ${msg} → Supadata 폴백`)
    }
  }

  // 2차 (TranscriptAPI 실패/자막없음 시에만): Supadata API로 자막 추출 (Whisper 폴백, timeout 적용)
  const supadataStart = Date.now()
  if (!transcript) try {
    // lang 없이 1회만 호출 (기본 언어 자막 사용). 실패(206 등)해도 1크레딧이 차감되므로
    // 과거의 ko→기본언어 2단계 호출(자막 없는 영상마다 2크레딧 소모)을 제거.
    const res = await fetchWithTimeout(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=true`,
      { headers: { 'x-api-key': process.env.SUPADATA_API_KEY! } },
      SUPADATA_TIMEOUT_MS
    )

    if (res.ok) {
      const data = await res.json()
      transcript = data.content ?? ''
      // 성공(res.ok) 시에만 기록 — 실소비되는 크레딧(성공분)과 카운트를 일치시킨다.
      // 실패(429 등)는 성공/실소비가 아니므로 제외. userId 없으면 시스템 계정 귀속.
      logApiUsage(userId ?? SYSTEM_USER_ID, 'supadata').catch(e => console.error('[supadata] logApiUsage 실패:', e))
      if (transcript) {
        console.log(`✅ Supadata 자막 추출 성공: ${videoId} (${Date.now() - supadataStart}ms)`)
      } else {
        // res.ok(200/206)인데 content 비어있음 → Whisper까지 봐도 자막 없음 = 확정
        transcriptMissing = true
        console.log(`❌ Supadata 자막 비어있음(확정): ${videoId} (status=${res.status}, ${Date.now() - supadataStart}ms)`)
      }
    } else if (isExhaustedStatus(res.status)) {
      // 크레딧 소진(429/402) → "확정 아님"(충전/유료 전환 후 자막 가능). transcript_checked 세우지 않는다.
      transcriptExhausted = true
      console.log(`⛔ Supadata 크레딧 소진(status=${res.status}): ${videoId} (${Date.now() - supadataStart}ms)`)
    } else if (res.status >= 400 && res.status < 500) {
      // 콘텐츠 없음 확정(404 등, 4xx) → 자막 없음 확정.
      transcriptMissing = true
      console.log(`❌ Supadata 자막 없음(확정, status=${res.status}): ${videoId} (${Date.now() - supadataStart}ms)`)
    } else {
      // 5xx 등 일시 오류 → 확정 아님(다음 주기 재시도).
      console.log(`❌ Supadata 일시 오류(status=${res.status}): ${videoId} (${Date.now() - supadataStart}ms)`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`❌ Supadata 에러/timeout: ${videoId} (${Date.now() - supadataStart}ms) — ${msg}`)
  }

  // 영상 설명 추출 — 1차: 공식 YouTube Data API (HTML 스크래핑은 차단/동의페이지로 100% 실패 중)
  const descStart = Date.now()
  try {
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`,
      {},
      YOUTUBE_HTML_TIMEOUT_MS
    )
    const data = await res.json()
    if (!res.ok || data.error) {
      console.log(`❌ YouTube API 설명 조회 실패: ${videoId} (status=${res.status}) — ${data.error?.message ?? ''}`)
    } else if (!data.items?.length) {
      // API는 정상 응답했지만 items가 비어있음 → 비공개/삭제된 영상
      unavailable = true
      console.log(`🗑 YouTube API: 비공개/삭제 영상 감지 (items 없음): ${videoId}`)
    } else {
      description = (data.items[0]?.snippet?.description ?? '').slice(0, 2000)
    }
    console.log(`⏱ [yt api] ${videoId} (${Date.now() - descStart}ms, descLen=${description.length})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`❌ YouTube API 설명 조회 에러/timeout: ${videoId} (${Date.now() - descStart}ms) — ${msg}`)
  }

  // 2차 (API 폴백 실패 시에만): HTML 스크래핑 (정규식 강화). 비공개/삭제 확정 시엔 생략.
  if (!description && !unavailable) {
    const htmlStart = Date.now()
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
      // isCrawlable 순서 의존 제거: 이스케이프를 고려한 문자열 리터럴 매칭
      const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)
      if (descMatch) {
        description = descMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .slice(0, 2000)
      } else {
        // shortDescription이 없으면 <meta name="description"> 도 시도
        const metaMatch = html.match(/<meta name="description" content="([^"]*)"/)
        if (metaMatch) description = metaMatch[1].slice(0, 2000)
      }
      console.log(`⏱ [yt html] ${videoId} (${Date.now() - htmlStart}ms, htmlLen=${html.length}, descLen=${description.length})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`❌ 설명 추출 실패/timeout: ${videoId} (${Date.now() - htmlStart}ms) — ${msg}`)
    }
  }

  console.log(`⏱ [getTranscript total] ${videoId} ${Date.now() - fnStart}ms (transcriptLen=${transcript.length})`)
  return { transcript, description, unavailable, transcriptExhausted, transcriptMissing }
}