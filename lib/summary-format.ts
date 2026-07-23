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
