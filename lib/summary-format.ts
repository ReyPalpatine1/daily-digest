// summary 문자열의 마커 해석 (요약 가독성 A/B 테스트 — SUMMARY_STYLE)
// - '## ' 로 시작하는 줄: 소제목 블록 (headline 스타일)
// - 빈 줄(\n\n): 문단 구분 (paragraph 스타일)
// - 마커 없는 기존 데이터(통짜 문자열)는 문단 1개로 반환 (하위 호환)
// DB 스키마·SummaryResult 타입은 그대로 두고 summary 문자열 안 마커만 해석한다.

export type SummaryBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }

export function parseSummaryBlocks(summary: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) blocks.push({ type: 'paragraph', text })
    buf = []
  }
  for (const rawLine of summary.split('\n')) {
    const line = rawLine.trim()
    if (/^##\s+/.test(line)) {
      flush()
      const text = line.replace(/^##\s+/, '').trim()
      if (text) blocks.push({ type: 'heading', text })
    } else if (line === '') {
      flush()
    } else {
      buf.push(rawLine.trimEnd())
    }
  }
  flush()
  return blocks
}

// summary 문자열을 문장 단위로 분리한다(공유 시트 문장 강조용).
// - 문단(\n\n)을 먼저 나눈 뒤, 각 문단을 한국어 종결 패턴 기준으로 문장 분리한다.
// - 종결부호(. ? ! 및 …·!? 같은 연속형) 뒤에 공백 또는 문자열 끝이 올 때만 경계로 본다.
//   → "9.5", "1.5배"처럼 마침표 뒤가 숫자/문자인 소수점·축약은 경계에 걸리지 않아 안전.
// - 각 문장은 trim + 빈 문자열 제거. 분리 결과가 없으면 전체를 한 문장으로 폴백한다.
// ※ 정규식 lookbehind는 Safari 15 미지원(.browserslistrc)이라 수동 스캔으로 구현한다.
const SENTENCE_TERMINATORS = '.?!。！？…'
export function splitSentences(summary: string): string[] {
  const text = (summary ?? '').trim()
  if (!text) return []
  const out: string[] = []
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    let start = 0
    for (let i = 0; i < p.length; i++) {
      if (!SENTENCE_TERMINATORS.includes(p[i])) continue
      // 연속 종결부호(…, ?!, !! 등)는 하나의 경계로 묶는다.
      let j = i
      while (j + 1 < p.length && SENTENCE_TERMINATORS.includes(p[j + 1])) j++
      const next = p[j + 1]
      const isBoundary = j + 1 >= p.length || next === ' ' || next === '\n' || next === '\t'
      if (isBoundary) {
        const sentence = p.slice(start, j + 1).trim()
        if (sentence) out.push(sentence)
        start = j + 1
      }
      i = j
    }
    const tail = p.slice(start).trim()
    if (tail) out.push(tail)
  }
  return out.length ? out : [text]
}

// summary의 `**볼드**` 마크다운(앵커 `**앵커.**` 포함)을 볼드/일반 세그먼트로 분리 — React 렌더용.
// 마커가 없으면 통짜 1세그먼트로 반환(하위 호환). lookbehind 미사용(Safari15 대응).
export function splitBoldSegments(text: string): { bold: boolean; text: string }[] {
  const s = text ?? ''
  const out: { bold: boolean; text: string }[] = []
  const re = /\*\*([^*\n]{1,40}?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ bold: false, text: s.slice(last, m.index) })
    out.push({ bold: true, text: m[1] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ bold: false, text: s.slice(last) })
  return out.length ? out : [{ bold: false, text: s }]
}

// 핵심 포인트 한 줄을 "앵커 — 설명" 형태로 분리 (4채널 공통 B안 디자인용).
// - 첫 번째 '—'(em dash) 기준으로 나누고 앞/뒤를 각각 trim (앞뒤 공백 유무 무관).
// - '—'가 없거나 앞부분이 비어 있으면 prefix=null → 호출부는 rest만 그대로 출력(형식 어긋난 항목 폴백).
export function splitKeyPointPrefix(text: string): { prefix: string | null; rest: string } {
  const s = String(text ?? '')
  const i = s.indexOf('—')
  if (i < 0) return { prefix: null, rest: s }
  const prefix = s.slice(0, i).trim()
  const rest = s.slice(i + 1).trim()
  if (!prefix) return { prefix: null, rest: s }
  return { prefix, rest }
}

// 이미 HTML 이스케이프된 문자열의 `**볼드**`를 <strong>/<b>로 변환 — 이메일/텔레그램(HTML)용.
// 마커 `**`는 이스케이프에 영향받지 않으므로 반드시 이스케이프 후 호출할 것.
export function boldMarkersToHtml(escaped: string, tag: 'strong' | 'b' = 'strong'): string {
  return String(escaped ?? '').replace(/\*\*([^*\n]{1,40}?)\*\*/g, `<${tag}>$1</${tag}>`)
}
