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
