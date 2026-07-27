'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { supabase } from '@/lib/supabase'
import { AppHeader } from '@/components/AppHeader'
import { usePending } from '@/lib/use-pending'
import { Star, CheckCircle } from 'lucide-react'

type FeedbackType = 'general' | 'bug' | 'feature'

export default function FeedbackPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()

  const [ready, setReady] = useState(false)
  const [rating, setRating] = useState(0) // 0 = 미선택
  const [type, setType] = useState<FeedbackType>('general')
  const [message, setMessage] = useState('')
  // 제출 진행 표시 — 200ms 이내 응답에선 켜지지 않는다(lib/use-pending.ts)
  const { pending: submitting, run: runSubmit } = usePending()
  const [submitted, setSubmitted] = useState(false)
  const [toastKey, setToastKey] = useState<string | null>(null)

  // 로그인 필수 — 세션 없으면 홈으로.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  function showToast(key: string) {
    setToastKey(key)
    setTimeout(() => setToastKey(null), 2500)
  }

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 14,
    padding: 24,
    boxSizing: 'border-box',
  }
  const label: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, display: 'block',
  }

  const canSubmit = message.trim().length >= 2 && message.trim().length <= 500 && !submitting

  const typeOptions: { value: FeedbackType; labelKey: string }[] = [
    { value: 'general', labelKey: 'feedback.typeGeneral' },
    { value: 'bug', labelKey: 'feedback.typeBug' },
    { value: 'feature', labelKey: 'feedback.typeFeature' },
  ]

  async function handleSubmit() {
    if (!canSubmit) return
    await runSubmit(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: rating > 0 ? rating : null,
          type,
          message: message.trim(),
          locale,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setSubmitted(true)
        return
      }
      showToast('feedback.errorToast')
    }).catch(() => {
      showToast('feedback.errorToast')
    })
  }

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack />

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 64px' }}>
        {submitted ? (
          <div style={{ ...card, padding: '40px 24px', textAlign: 'center' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', background: 'var(--bg-subtle)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}>
              <CheckCircle size={30} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('feedback.successTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
              {t('feedback.successBody')}
            </div>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              style={{
                minWidth: 120, height: 42, borderRadius: 8, border: '0.5px solid var(--border)',
                background: 'transparent', color: 'var(--text-primary)', fontWeight: 500,
                fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {t('feedback.close')}
            </button>
          </div>
        ) : (
        <div style={card}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px', letterSpacing: -0.3 }}>
            {t('feedback.title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 24px' }}>
            {t('feedback.subtitle')}
          </p>

          {/* 별점(선택) */}
          <div style={{ marginBottom: 20 }}>
            <span style={label}>
              {t('feedback.ratingLabel')}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                {t('feedback.ratingOptional')}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 2, 3, 4, 5].map(n => {
                const active = n <= rating
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(prev => (prev === n ? 0 : n))}
                    style={{
                      background: 'transparent', border: 'none', padding: 2,
                      cursor: 'pointer', lineHeight: 0,
                    }}
                    aria-label={`${n}`}
                  >
                    <Star
                      size={26}
                      strokeWidth={1.75}
                      style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                      fill={active ? 'var(--accent)' : 'none'}
                    />
                  </button>
                )
              })}
            </div>
          </div>

          {/* 유형 */}
          <div style={{ marginBottom: 20 }}>
            <span style={label}>{t('feedback.typeLabel')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {typeOptions.map(opt => {
                const selected = type === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setType(opt.value)}
                    style={{
                      flex: 1, padding: '9px 8px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                      background: selected ? 'var(--text-primary)' : 'var(--bg-subtle)',
                      color: selected ? 'var(--bg-card)' : 'var(--text-secondary)',
                      border: selected ? 'none' : '0.5px solid var(--border)',
                    }}
                  >
                    {t(opt.labelKey)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 내용 */}
          <div style={{ marginBottom: 20 }}>
            <span style={label}>{t('feedback.messageLabel')}</span>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={t('feedback.messagePlaceholder')}
              maxLength={500}
              style={{
                width: '100%', minHeight: 96, resize: 'vertical', boxSizing: 'border-box',
                background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8,
                padding: '11px 12px', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
            <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              {message.length}/500
            </div>
          </div>

          {/* 보내기 */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              width: '100%', height: 44, borderRadius: 8, border: 'none',
              background: 'var(--text-primary)', color: 'var(--bg-card)',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              cursor: canSubmit ? 'pointer' : 'default',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {submitting ? t('common.processing') : t('feedback.submit')}
          </button>
        </div>
        )}
      </main>

      {/* 토스트 */}
      {toastKey && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
          padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)',
        }}>
          {t(toastKey)}
        </div>
      )}
    </div>
  )
}
