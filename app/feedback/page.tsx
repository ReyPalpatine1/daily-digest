'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { supabase } from '@/lib/supabase'
import { AppHeader } from '@/components/AppHeader'
import { usePending } from '@/lib/use-pending'
import { SkeletonBlock } from '@/components/Skeleton'
import { Star, CheckCircle } from 'lucide-react'

type FeedbackType = 'general' | 'bug' | 'feature'

export default function FeedbackPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()

  // 첫 진입 사용자 정보 로딩 구간(해제 전까지 입력 영역 자리에 뼈대 표시)
  const [initialLoading, setInitialLoading] = useState(true)
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
      // 리다이렉트 경로는 화면이 곧 사라지므로 뼈대를 유지한 채 빠진다.
      if (!data.user) { router.push('/'); return }
      setInitialLoading(false)
    }).catch(() => { if (!cancelled) setInitialLoading(false) })
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

  // 로딩 중에는 본문(제목·별점·유형·입력·버튼) 대신 뼈대를 렌더한다.
  // 문구가 나중에 채워져 보이지 않도록, 번역 언어가 확정된 뒤에만 본문을 그린다:
  // LocaleProvider가 마운트 이펙트에서 localStorage/브라우저 언어를 적용하고,
  // initialLoading은 그보다 늦은 auth 응답 시점에 해제되므로 본문은 확정 언어로 한 번에 그려진다.
  // 모양은 app/feedback/loading.tsx와 동일(전환 → 데이터 로딩 구간이 이어져 보이게).
  if (initialLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
      }}>
        <AppHeader showBack />
        <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 64px' }}>
          <div style={{ marginBottom: 20 }}>
            <SkeletonBlock height={22} width="46%" />
          </div>
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SkeletonBlock height={13} width={120} />
            <SkeletonBlock height={28} width={180} />
            <div style={{ height: 12 }} />
            <SkeletonBlock height={13} width={90} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <SkeletonBlock height={40} />
              <SkeletonBlock height={40} />
              <SkeletonBlock height={40} />
            </div>
            <div style={{ height: 12 }} />
            <SkeletonBlock height={13} width={90} />
            <SkeletonBlock height={140} />
            <SkeletonBlock height={44} />
          </div>
        </main>
      </div>
    )
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

          {/* 유형 — 세로 목록(공유 신고 모달의 사유 선택과 같은 규칙) */}
          <div style={{ marginBottom: 20 }}>
            <span style={label}>{t('feedback.typeLabel')}</span>
            {typeOptions.map(opt => {
              const selected = type === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', boxSizing: 'border-box',
                    padding: '11px 13px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit', marginBottom: 7,
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

          {/* 내용 — 글자 수는 라벨 줄 오른쪽에 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{ ...label, marginBottom: 0 }}>{t('feedback.messageLabel')}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {message.length}/500
              </span>
            </div>
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
