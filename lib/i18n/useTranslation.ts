'use client'

import { useContext } from 'react'
import { LocaleContext } from './LocaleProvider'

// 언어 상태/번역 함수는 LocaleProvider(Context)에서 단일 인스턴스로 관리된다.
// 컴포넌트마다 독립 상태를 갖던 과거 구현을 통합 — useTranslation은 Context 소비만 한다.
// 반환 형태 { t, locale, changeLocale }는 기존과 동일하므로 호출부는 무수정.
export function useTranslation() {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useTranslation must be used within a LocaleProvider')
  }
  return ctx
}
