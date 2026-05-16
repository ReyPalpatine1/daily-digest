'use client'

import { useCallback, useEffect, useState } from 'react'
import { translations, type Locale } from './translations'

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ko'
  try {
    const saved = localStorage.getItem('locale')
    if (saved === 'ko' || saved === 'en') return saved
  } catch {}
  const browserLang = (navigator.language || (navigator as any).userLanguage || '').toLowerCase()
  return browserLang.startsWith('ko') ? 'ko' : 'en'
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
      let value: any = translations[locale]
      for (const k of keys) {
        value = value?.[k]
        if (value === undefined) return key
      }
      if (typeof value !== 'string') return key
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
