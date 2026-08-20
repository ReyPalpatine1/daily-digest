'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { AppHeader } from '@/components/AppHeader'
import { CheckCircle2, XCircle, CreditCard } from 'lucide-react'

// 토스 카드 등록창의 리다이렉트 착지점.
// 성공: ?customerKey=&authKey= → /api/billing/authorize 로 넘겨 빌링키를 발급받는다.
// 실패: ?fail=1 또는 ?code=&message= (사용자가 창을 닫으면 code=USER_CANCEL).
// 이 화면에서 결제는 일어나지 않는다 — 카드 등록까지다.

type Status = 'loading' | 'success' | 'fail' | 'canceled'

function BillingResultContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { locale } = useTranslation()

  const [status, setStatus] = useState<Status>('loading')
  const [failMessage, setFailMessage] = useState<string | null>(null)
  // 개발 모드의 이펙트 2회 실행으로 authKey가 두 번 소비되지 않게 한다.
  const startedRef = useRef(false)

  const authKey = searchParams.get('authKey')
  const customerKey = searchParams.get('customerKey')
  const failFlag = searchParams.get('fail')
  const failCode = searchParams.get('code')
  const failMessageParam = searchParams.get('message')

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    // 토스 실패 리다이렉트 — 창을 닫은 것(USER_CANCEL)은 오류가 아니라 취소로 본다.
    if (failFlag || failCode) {
      if (failCode === 'USER_CANCEL') { setStatus('canceled'); return }
      setFailMessage(failMessageParam)
      setStatus('fail')
      return
    }

    if (!authKey || !customerKey) { setStatus('fail'); return }

    fetch('/api/billing/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey, customerKey }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (res.ok && data?.ok) { setStatus('success'); return }
        setFailMessage(typeof data?.message === 'string' ? data.message : null)
        setStatus('fail')
      })
      .catch(() => setStatus('fail'))
  }, [authKey, customerKey, failFlag, failCode, failMessageParam])

  const billingResult = (((translations as Record<string, any>)[locale]?.billingResult) ?? translations.en.billingResult) as typeof translations.ko.billingResult
  const subscribeSuccess = (((translations as Record<string, any>)[locale]?.subscribeSuccess) ?? translations.en.subscribeSuccess) as typeof translations.ko.subscribeSuccess

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 14,
    padding: 24,
    boxSizing: 'border-box',
    textAlign: 'center',
  }
  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 9, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-card)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
  const secondaryBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 9,
    border: '0.5px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
  const titleStyle: React.CSSProperties = {
    fontSize: 17, fontWeight: 600, letterSpacing: -0.3, margin: '14px 0 0',
  }
  const descStyle: React.CSSProperties = {
    fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.7, marginTop: 8,
  }

  const title =
    status === 'success' ? billingResult.successTitle
      : status === 'canceled' ? billingResult.canceledTitle
        : billingResult.failTitle
  const desc =
    status === 'success' ? billingResult.successDesc
      : status === 'canceled' ? billingResult.canceledDesc
        : failMessage

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack />

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px' }}>
        {status === 'loading' ? (
          <div style={card}>
            <CreditCard size={28} style={{ color: 'var(--text-tertiary)' }} />
            <div style={descStyle}>{billingResult.registering}</div>
          </div>
        ) : (
          <>
            <div style={{ ...card, marginBottom: 16 }}>
              {status === 'success'
                ? <CheckCircle2 size={30} style={{ color: 'var(--success)' }} />
                : <XCircle size={30} style={{ color: status === 'canceled' ? 'var(--text-tertiary)' : 'var(--danger)' }} />}
              <h1 style={titleStyle}>{title}</h1>
              {desc && <div style={descStyle}>{desc}</div>}
            </div>

            {status === 'success' ? (
              <button style={primaryBtn} onClick={() => router.push('/dashboard')}>
                {subscribeSuccess.goDashboard}
              </button>
            ) : (
              <button style={secondaryBtn} onClick={() => router.push('/subscribe')}>
                {billingResult.backToSubscribe}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default function BillingResultPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />}>
      <BillingResultContent />
    </Suspense>
  )
}
