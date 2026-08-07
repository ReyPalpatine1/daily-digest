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

// 언어 변경 안내 토스트 노출 시간(ms). 기존 토스트(2.5초)보다 긴 이유는
// 두 문장이라 읽는 데 시간이 더 걸리기 때문이다.
const LOCALE_NOTICE_MS = 4000

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ko')
  // 로그인된 유저 id. changeLocale이 DB 저장 시 사용 (호출부는 userId를 안 넘김).
  const userIdRef = useRef<string | null>(null)
  // 언어 변경 안내 토스트. changeLocale(사용자가 직접 고른 경우)에서만 켜진다 —
  // 부팅 경로(detectInitialLocale·DB 동기화)는 applyLocale만 부르므로 뜨지 않는다.
  const [showLocaleNotice, setShowLocaleNotice] = useState(false)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
  }, [])

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
    // 실제로 언어가 바뀐 경우에만 안내. 같은 언어를 다시 고르면 바뀐 게 없으므로 띄우지 않는다.
    // 저장(localStorage·DB)은 기존과 동일하게 항상 수행한다 — 여기서 조기 반환하면
    // DB 값이 어긋나 있던 계정이 계속 어긋난 채로 남는다.
    if (newLocale !== locale) {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
      setShowLocaleNotice(true)
      noticeTimerRef.current = setTimeout(() => {
        setShowLocaleNotice(false)
        noticeTimerRef.current = null
      }, LOCALE_NOTICE_MS)
    }
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
  }, [applyLocale, locale])

  return (
    <LocaleContext.Provider value={{ t, locale, changeLocale }}>
      {children}
      {/* 언어 변경 안내 — 대시보드의 잠금/미리보기 토스트와 동일한 토큰(하단 중앙 알약).
          bg=text-primary / 글씨=bg-card 라 라이트·다크 양쪽에서 자동 반전·대비된다.
          두 문장이라 폭이 넓어지므로 maxWidth로 감싸고 좌우 16px 여백을 확보한다.
          문구는 t()로 렌더 시점에 읽으므로 "바뀐 뒤의 언어"로 나온다. */}
      {showLocaleNotice && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
          padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)',
          maxWidth: 'min(420px, calc(100vw - 32px))',
          lineHeight: 1.5, textAlign: 'center',
        }}>
          {t('common.localeChangedNotice')}
        </div>
      )}
    </LocaleContext.Provider>
  )
}
