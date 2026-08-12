// summary_basis 판정 헬퍼.
// lib/gemini.ts summarizeVideo()가 저장하는 실제 값은 로케일과 무관하게 한국어 고정:
//   '자동 생성 자막 기반 요약' | '영상 설명 기반 요약' | '자막 확보 실패 기반 요약'
//   (과거 데이터: '제목 기반 요약')
// 알 수 없는 값은 false 반환 → 게이트하지 않고 기존대로 제공 (오탐으로 잠그는 것 방지).

export const DESCRIPTION_SUMMARY_BASIS = '영상 설명 기반 요약'

// 자막 API 크레딧 소진(429/402)·오류로 자막을 못 받아 설명으로 대체한 요약.
// 콘텐츠에 자막이 없는 것이 아니라 "우리 쪽 사정"이므로 위 값과 구분해 저장한다.
// ⚠️ 이 값도 '자막'이라는 단어를 포함하므로, basis.includes('자막')류의 부분 문자열 판정보다
//    먼저 정확 일치로 걸러야 한다(자막 기반 요약으로 오인 방지).
export const SUMMARY_BASIS_TRANSCRIPT_FAILED = '자막 확보 실패 기반 요약'

// 자막 없이 영상 설명만으로 생성된 요약인지 (무료 사용자에게는 Pro 전용으로 게이트).
// 자막 확보 실패(SUMMARY_BASIS_TRANSCRIPT_FAILED)는 여기서 false — Pro 전용이 아니라
// 별도 사유(transcript_failed)로 분기하기 위함이다(게이트 자체는 유지).
export function isDescriptionBasedSummary(basis: string | null | undefined): boolean {
  return basis === DESCRIPTION_SUMMARY_BASIS
}

// 자막 확보 실패로 설명 대체된 요약인지 (무료에겐 사유만 다른 동일한 숨김 처리)
export function isTranscriptFailedSummary(basis: string | null | undefined): boolean {
  return basis === SUMMARY_BASIS_TRANSCRIPT_FAILED
}
