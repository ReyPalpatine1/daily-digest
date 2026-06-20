'use client'

import { useCallback, useEffect, useState } from 'react'
import { translations, type Locale } from './translations'
import { supabase } from '@/lib/supabase'

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

// <html lang>용 BCP47 태그. 브라우저의 <input type="date"> 등 네이티브 UI 언어가 이걸 따른다.
const htmlLangTag: Record<Locale, string> = {
  ko: 'ko',
  en: 'en',
  zh: 'zh-CN',
  ja: 'ja',
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
    document.documentElement.lang = htmlLangTag[detected]
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

  // userId를 넘기면 settings.locale(이메일 발송 언어)에도 저장한다. 안 넘기면 기존과
  // 동일하게 localStorage만 갱신(user 정보 없는 호출부 다수 → 시그니처 호환 유지).
  // changeLocale은 사용자가 직접 바꿀 때만 호출되므로 초기 로드 시엔 저장되지 않는다.
  const changeLocale = useCallback((newLocale: Locale, userId?: string) => {
    setLocale(newLocale)
    document.documentElement.lang = htmlLangTag[newLocale]
    try { localStorage.setItem('locale', newLocale) } catch {}
    if (userId) {
      // supabase는 lazy Proxy라 상단 static import해도 모듈 로드 시 클라이언트를 만들지 않는다.
      // 저장 실패해도 UI 전환은 유지(console.warn만).
      supabase
        .from('settings')
        .update({ locale: newLocale })
        .eq('user_id', userId)
        .then(({ error }) => { if (error) console.warn('[locale] DB 저장 실패:', error.message) })
    }
  }, [])

  return { t, locale, changeLocale }
}
