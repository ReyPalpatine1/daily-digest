'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { supabase } from '@/lib/supabase'
import { AppHeader } from '@/components/AppHeader'
import { CreditCard, Lock } from 'lucide-react'

const PRICE_MONTHLY = 4900

type PayType = 'auto' | 'onetime'

function SubscribeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale } = useTranslation()

  const mode: 'trial' | 'pay' = searchParams.get('mode') === 'trial' ? 'trial' : 'pay'

  const [ready, setReady] = useState(false)
  const [payType, setPayType] = useState<PayType>('auto')
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreeAutoPay, setAgreeAutoPay] = useState(false)
  const [toastKey, setToastKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // trial 모드로 잘못 진입한 재가입자(체험 이력 있음) 대비 — 확인 전엔 화면 미확정.
  const [trialChecked, setTrialChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  useEffect(() => {
    if (mode !== 'trial') { setTrialChecked(true); return }
    let cancelled = false
    fetch('/api/subscription/trial')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data?.eligible === false) router.replace('/subscribe?mode=pay')
        setTrialChecked(true)
      })
      .catch(() => {
        // 조회 실패 시 trial 화면 유지(POST 서버 검증이 최종 방어선)
        if (!cancelled) setTrialChecked(true)
      })
    return () => { cancelled = true }
  }, [mode, router])

  const subscribe = (((translations as Record<string, any>)[locale]?.subscribe) ?? translations.en.subscribe) as typeof translations.ko.subscribe
  const pricing = (((translations as Record<string, any>)[locale]?.pricing) ?? translations.en.pricing) as typeof translations.ko.pricing

  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const won = (n: number) => `₩${n.toLocaleString(dateLocale)}`
  const billingDate = new Date()
  billingDate.setDate(billingDate.getDate() + 7)
  const billingDateLabel = billingDate.toLocaleDateString(dateLocale)

  function showToast(key: string) {
    setToastKey(key)
    setTimeout(() => setToastKey(null), 2500)
  }

  const canSubmit = mode === 'trial' ? agreeTerms : agreeTerms && (payType !== 'auto' || agreeAutoPay)

  async function startTrial() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/subscription/trial', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        router.push('/dashboard')
        return
      }
      if (data.error === 'trial_already_used') {
        // 체험 불가 안내 후 결제 모드로 전환 — 사용자가 바로 결제 흐름을 이어갈 수 있게.
        showToast('subscribe.trialUsedNotice')
        router.replace('/subscribe?mode=pay')
        return
      }
      showToast('adminUsers.actionFailed')
    } catch {
      showToast('adminUsers.actionFailed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit() {
    if (!canSubmit) { showToast('subscribe.needAgree'); return }
    if (mode === 'trial') { startTrial(); return }
    showToast('profile.paymentComingSoon')
  }

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 14,
    padding: 20,
    boxSizing: 'border-box',
  }
  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12 }
  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)',
    fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  }
  const label: React.CSSProperties = { fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, display: 'block' }
  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 9, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-card)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
  const disabledBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 9, border: '0.5px solid var(--border)',
    background: 'var(--bg-subtle)', color: 'var(--text-muted)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }

  function payOption(value: PayType, title: string, desc: string) {
    const selected = payType === value
    return (
      <button
        onClick={() => setPayType(value)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
          textAlign: 'left', padding: '12px 14px', borderRadius: 10,
          border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)',
          background: 'var(--bg-card)', cursor: 'pointer', fontFamily: 'inherit',
          marginBottom: 8,
        }}>
        <input
          type="radio"
          checked={selected}
          onChange={() => setPayType(value)}
          style={{ width: 15, height: 15, marginTop: 2, cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{desc}</div>
        </div>
      </button>
    )
  }

  if (!ready || !trialChecked) {
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

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 20px', letterSpacing: -0.4 }}>
          {subscribe.title}
        </h1>

        {/* 선택한 플랜 */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ ...label, marginBottom: 8 }}>{subscribe.selectedPlan}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{pricing.pro}</span>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>{won(PRICE_MONTHLY)}</span>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{pricing.perMonth}</span>
          </div>
        </div>

        {mode === 'trial' ? (
          /* 체험 안내 (카드 없이 시작) */
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={sectionTitle}>{subscribe.firstWeekFree}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('subscribe.trialEnds', { date: billingDateLabel })}
            </div>
          </div>
        ) : (
          <>
            {/* 결제 방식 */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={sectionTitle}>{subscribe.paymentMethod}</div>
              {payOption('auto', subscribe.proMonthly, `${won(PRICE_MONTHLY)} · ${pricing.perMonth}`)}
              {payOption('onetime', subscribe.onetime, `${won(PRICE_MONTHLY)} · ${subscribe.onetimeNotice}`)}
            </div>

            {/* 결제 수단 (카드) */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CreditCard size={16} style={{ color: 'var(--text-secondary)' }} />
                {subscribe.creditCard}
              </div>
              <div style={{ marginBottom: 12 }}>
                <span style={label}>{subscribe.cardNumber}</span>
                <input
                  style={inputStyle}
                  value={cardNumber}
                  onChange={e => setCardNumber(e.target.value)}
                  placeholder="0000 0000 0000 0000"
                  inputMode="numeric"
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <span style={label}>{subscribe.expiry}</span>
                  <input
                    style={inputStyle}
                    value={expiry}
                    onChange={e => setExpiry(e.target.value)}
                    placeholder="MM/YY"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={label}>{subscribe.cvc}</span>
                  <input
                    style={inputStyle}
                    value={cvc}
                    onChange={e => setCvc(e.target.value)}
                    placeholder="CVC"
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div>
                <span style={label}>{subscribe.cardHolder}</span>
                <input
                  style={inputStyle}
                  value={cardHolder}
                  onChange={e => setCardHolder(e.target.value)}
                  placeholder={subscribe.cardHolder}
                />
              </div>
            </div>
          </>
        )}

        {/* 약관 동의 */}
        <div style={{ ...card, marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={e => setAgreeTerms(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            {subscribe.agreeTerms}
          </label>
          {mode === 'pay' && payType === 'auto' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', marginTop: 10 }}>
              <input
                type="checkbox"
                checked={agreeAutoPay}
                onChange={e => setAgreeAutoPay(e.target.checked)}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
              />
              {subscribe.agreeAutoPay}
            </label>
          )}
        </div>

        <button style={canSubmit ? primaryBtn : disabledBtn} onClick={handleSubmit} disabled={submitting}>
          {submitting ? '···' : mode === 'trial' ? subscribe.startTrialCta : subscribe.payCta}
        </button>

        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <Lock size={12} />
          {subscribe.secureNote}
        </div>
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

export default function SubscribePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />}>
      <SubscribeContent />
    </Suspense>
  )
}
