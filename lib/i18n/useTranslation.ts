'use client'

import { useCallback, useEffect, useState } from 'react'
import { translations, type Locale } from './translations'

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ko'
  try {
    const saved = localStorage.getItem('locale')
    if (saved === 'ko' || saved === 'en' || saved === 'zh' || saved === 'ja') return saved
  } catch {}
  const browserLang = (navigator.language || (navigator as any).userLanguage || '').toLowerCase()
  if (browserLang.startsWith('ko')) return 'ko'
  if (browserLang.startsWith('zh')) return 'zh'
  if (browserLang.startsWith('ja')) return 'ja'
  return 'en'
}

// 한 사전에서 'a.b.c' 키를 따라가 문자열을 찾는다. 없으면 undefined.
function lookup(dict: any, keys: string[]): string | undefined {
  let value: any = dict
  for (const k of keys) {
    value = value?.[k]
    if (value === undefined) return undefined
  }
  return typeof value === 'string' ? value : undefined
}

export function useTranslation() {
  const [locale, setLocale] = useState<Locale>('ko')

  useEffect(() => {
    const detected = detectInitialLocale()
    setLocale(detected)
    document.documentElement.lang = detected
  }, [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const keys = key.split('.')
      const dicts = translations as Record<string, any>
      // 현재 언어 → en 폴백 → 키 문자열. (zh/ja는 번역 없으면 영어로 표시)
      let value = lookup(dicts[locale], keys)
      if (value === undefined && locale !== 'en') value = lookup(dicts['en'], keys)
      if (value === undefined) return key
      if (params) {
        return value.replace(/\{(\w+)\}/g, (_, paramKey) =>
          String(params[paramKey] ?? `{${paramKey}}`)
        )
      }
      return value
    },
    [locale]
  )

  const changeLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale)
    document.documentElement.lang = newLocale
    try { localStorage.setItem('locale', newLocale) } catch {}
  }, [])

  return { t, locale, changeLocale }
}
