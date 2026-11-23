'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MailX } from 'lucide-react'
import LogoMark from '@/components/LogoMark'
import { translations } from '@/lib/i18n/translations'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { usePending } from '@/lib/use-pending'
import { TOAST_MS } from '@/lib/toast'

// 광고 수신거부 링크 페이지 (로그인 불필요 · 서명 토큰 ?t=).
// ★ 메일 보안 검사기의 링크 미리 열기(GET)로 철회되지 않도록, 처리는 페이지가 열린 뒤
//   브라우저에서 POST /api/unsubscribe 를 자동 호출해서 한다. 사람에게는 확인 단계 없이 바로 처리된다.
// 완료 화면은 회원의 언어(서버가 돌려준 settings.locale)로, 그 전·오류 화면은 브라우저 언어로 표시한다.

type Locale = keyof typeof translations
const LOCALES: Locale[] = ['ko', 'en', 'zh', 'ja']
const DATE_LOCALE: Record<Locale, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' }

// 회원 언어로 사전을 직접 읽는다(전역 언어 설정을 바꾸지 않기 위해 changeLocale을 쓰지 않는다).
function tr(locale: Locale, key: string, params?: Record<string, string>): string {
  let v: any = translations[locale]
  for (const k of key.split('.')) v = v?.[k]
  if (typeof v !== 'string') return key
  return params ? v.replace(/\{(\w+)\}/g, (_, p) => params[p] ?? `{${p}}`) : v
}

type State =
  | { kind: 'loading' }
  | { kind: 'done'; locale: Locale; processedAt: string; adConsent: boolean }
  | { kind: 'invalid' }
  | { kind: 'error' }

export default function UnsubscribePage() {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRef = useRef<string>('')
  const startedRef = useRef(false)
  const resub = usePending()

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => { setToast(null); toastTimerRef.current = null }, TOAST_MS)
  }, [])

  const post = useCallback(async (action?: 'resubscribe') => {
    const res = await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: tokenRef.current, ...(action ? { action } : {}) }),
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }, [])

  const unsubscribe = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const { res, data } = await post()
      if (res.status === 400) { setState({ kind: 'invalid' }); return }
      if (!res.ok || !data.success) { setState({ kind: 'error' }); return }
      const locale: Locale = LOCALES.includes(data.locale) ? data.locale : 'ko'
      setState({ kind: 'done', locale, processedAt: data.processedAt, adConsent: !!data.adConsent })
    } catch {
      setState({ kind: 'error' })
    }
  }, [post])

  // 열리자마자 1회 자동 처리(StrictMode 이중 실행 방지).
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    tokenRef.current = new URLSearchParams(window.location.search).get('t') ?? ''
    if (!tokenRef.current) { setState({ kind: 'invalid' }); return }
    void unsubscribe()
  }, [unsubscribe])

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])

  async function resubscribe() {
    if (state.kind !== 'done') return
    const locale = state.locale
    await resub.run(async () => {
      try {
        const { res, data } = await post('resubscribe')
        if (!res.ok || !data.success) throw new Error(`resubscribe ${res.status}`)
        setState({ kind: 'done', locale, processedAt: state.processedAt, adConsent: true })
        showToast(tr(locale, 'schedule.adConsentOnToast'))
      } catch {
        showToast(tr(locale, 'unsubscribe.failed'))
      }
    })
  }

  const mainBtn: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 8, border: 'none',
    background: 'var(--text-primary)', color: 'var(--bg-card)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }

  let title = ''
  let body = ''
  let action: React.ReactNode = null
  if (state.kind === 'loading') {
    body = t('common.loading')
  } else if (state.kind === 'invalid') {
    title = t('unsubscribe.invalidTitle')
    body = t('unsubscribe.invalidBody')
  } else if (state.kind === 'error') {
    title = t('unsubscribe.failed')
    action = <button type="button" onClick={() => void unsubscribe()} style={mainBtn}>{t('unsubscribe.retry')}</button>
  } else {
    const date = new Date(state.processedAt).toLocaleDateString(DATE_LOCALE[state.locale], {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
    })
    title = tr(state.locale, 'unsubscribe.title')
    body = tr(state.locale, 'unsubscribe.body', { date })
    // 다시 동의하면 버튼을 거둔다(완료 토스트로 결과를 알린다).
    if (!state.adConsent) {
      action = (
        <button type="button" onClick={resubscribe} disabled={resub.pending}
          style={{ ...mainBtn, ...(resub.pending ? { opacity: 0.5, cursor: 'default' } : {}) }}>
          {resub.pending ? tr(state.locale, 'common.processing') : tr(state.locale, 'unsubscribe.resubscribe')}
        </button>
      )
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px', boxSizing: 'border-box',
    }}>
      <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20, textDecoration: 'none', color: 'var(--text-primary)' }}>
        <LogoMark />
        <span style={{ fontSize: 15, fontWeight: 600 }}>Daily Video Digest</span>
      </a>
      <div style={{
        width: '100%', maxWidth: 420, boxSizing: 'border-box',
        background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14,
        padding: '28px 24px', textAlign: 'center',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%', background: 'var(--bg-subtle)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)', marginBottom: 16,
        }}>
          <MailX size={26} />
        </div>
        {title && (
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>{title}</div>
        )}
        {body && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{body}</div>
        )}
        {action && <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>{action}</div>}
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
          padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
