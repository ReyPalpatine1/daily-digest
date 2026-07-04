// summary_basis 판정 헬퍼.
// lib/gemini.ts summarizeVideo()가 저장하는 실제 값은 로케일과 무관하게 한국어 고정:
//   '자동 생성 자막 기반 요약' | '영상 설명 기반 요약' (과거 데이터: '제목 기반 요약')
// 알 수 없는 값은 false 반환 → 게이트하지 않고 기존대로 제공 (오탐으로 잠그는 것 방지).

export const DESCRIPTION_SUMMARY_BASIS = '영상 설명 기반 요약'

// 자막 없이 영상 설명만으로 생성된 요약인지 (무료 사용자에게는 Pro 전용으로 게이트)
export function isDescriptionBasedSummary(basis: string | null | undefined): boolean {
  return basis === DESCRIPTION_SUMMARY_BASIS
}
