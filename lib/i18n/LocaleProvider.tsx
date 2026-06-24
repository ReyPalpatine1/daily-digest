'use client'

import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { translations, type Locale } from './translations'
import { supabase } from '@/lib/supabase'

// 초기 렌더 플래시 방지: localStorage → 브라우저 언어 폴백 (DB는 마운트 후 비동기로 덮어씀).
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

function isLocale(v: unknown): v is Locale {
  return v === 'ko' || v === 'en' || v === 'zh' || v === 'ja'
}

export type LocaleContextValue = {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: Locale
  changeLocale: (newLocale: Locale) => void
}

export const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ko')
  // 로그인된 유저 id. changeLocale이 DB 저장 시 사용 (호출부는 userId를 안 넘김).
  const userIdRef = useRef<string | null>(null)

  // 현재 언어를 상태 + localStorage + <html lang>에 일괄 반영.
  const applyLocale = useCallback((next: Locale) => {
    setLocale(next)
    document.documentElement.lang = htmlLangTag[next]
    try { localStorage.setItem('locale', next) } catch {}
  }, [])

  useEffect(() => {
    // 1) 첫 렌더 플래시 방지: localStorage/브라우저 폴백 즉시 적용.
    setLocale(detectInitialLocale())
    document.documentElement.lang = htmlLangTag[detectInitialLocale()]

    // 2) 로그인 유저의 settings.locale을 "권위값"으로 동기화 (기기 간 동기화).
    let cancelled = false
    const syncFromDb = async (userId: string | undefined) => {
      userIdRef.current = userId ?? null
      if (!userId) return
      const { data, error } = await supabase
        .from('settings')
        .select('locale')
        .eq('user_id', userId)
        .single()
      if (cancelled || error) return
      if (isLocale(data?.locale)) applyLocale(data.locale)
    }

    supabase.auth.getUser().then(({ data }) => { syncFromDb(data.user?.id) })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      syncFromDb(session?.user?.id)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [applyLocale])

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

  // 사용자가 직접 언어를 바꿀 때 호출. localStorage + (로그인 상태면) settings.locale 저장.
  const changeLocale = useCallback((newLocale: Locale) => {
    applyLocale(newLocale)
    const userId = userIdRef.current
    if (userId) {
      // supabase는 lazy Proxy라 상단 static import해도 모듈 로드 시 클라이언트를 만들지 않는다.
      // 저장 실패해도 UI 전환은 유지(console.warn만).
      supabase
        .from('settings')
        .update({ locale: newLocale })
        .eq('user_id', userId)
        .then(({ error }) => { if (error) console.warn('[locale] DB 저장 실패:', error.message) })
    }
  }, [applyLocale])

  return (
    <LocaleContext.Provider value={{ t, locale, changeLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}
