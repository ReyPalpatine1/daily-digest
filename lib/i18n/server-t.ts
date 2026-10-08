// 언어를 직접 지정하는 번역 함수 — LocaleProvider(보는 사람의 언어) 밖에서 쓴다.
//
// 공유 페이지(/s/[token])는 보는 사람이 아니라 "공유자가 고른 언어"로 나와야 하고,
// 서버 컴포넌트라 useTranslation을 쓸 수 없다. 그래서 사전을 직접 읽는다.
// 같은 언어로 맞춰야 하는 클라이언트 컴포넌트(신고 창·타임라인 토글)도 이 함수를 쓴다.
//
// 동작은 LocaleProvider의 t와 같다: 해당 언어 → en 폴백 → 키 문자열, {name} 치환.
import { translations, type Locale } from './translations'

export type TFn = (key: string, params?: Record<string, string | number>) => string

export function isLocale(v: unknown): v is Locale {
  return v === 'ko' || v === 'en' || v === 'zh' || v === 'ja'
}

function lookup(dict: unknown, keys: string[]): string | undefined {
  let value: unknown = dict
  for (const k of keys) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[k]
  }
  return typeof value === 'string' ? value : undefined
}

export function getT(locale: Locale): TFn {
  return (key, params) => {
    const keys = key.split('.')
    let value = lookup(translations[locale], keys)
    if (value === undefined && locale !== 'en') value = lookup(translations.en, keys)
    if (value === undefined) return key
    if (!params) return value
    return value.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? `{${p}}`))
  }
}
