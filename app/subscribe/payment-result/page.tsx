'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { AppHeader } from '@/components/AppHeader'
import { CheckCircle2, XCircle, CreditCard } from 'lucide-react'

// 1개월권(단건 결제) 결제창의 리다이렉트 착지점.
// 성공: ?paymentKey=&orderId=&amount= → /api/billing/confirm 이 승인한다.
//   · 승인 전까지는 결제가 확정되지 않는다 — 이 페이지를 거쳐야 결제가 끝난다.
//   · amount는 서버가 저장해 둔 금액과 대조만 한다(위변조 방지). 서버가 최종 판단한다.
//   · 새로고침해도 서버가 멱등 처리하므로 두 번 결제되지 않는다.
// 실패: ?fail=1 또는 ?code=&message= (창을 닫으면 code=USER_CANCEL).

type Status = 'loading' | 'success' | 'fail' | 'canceled'

function PaymentResultContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale } = useTranslation()

  const [status, setStatus] = useState<Status>('loading')
  const [failMessage, setFailMessage] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  // 헤더는 진입 시점(결제 전) 프로필을 들고 있다 — 승인 뒤 이 값을 올려 다시 읽게 한다.
  const [planRefreshKey, setPlanRefreshKey] = useState(0)
  // 개발 모드의 이펙트 2회 실행으로 승인이 두 번 요청되지 않게 한다.
  const startedRef = useRef(false)

  const paymentKey = searchParams.get('paymentKey')
  const orderId = searchParams.get('orderId')
  const amount = searchParams.get('amount')
  const failFlag = searchParams.get('fail')
  const failCode = searchParams.get('code')
  const failMessageParam = searchParams.get('message')

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (failFlag || failCode) {
      if (failCode === 'USER_CANCEL') { setStatus('canceled'); return }
      setFailMessage(failMessageParam)
      setStatus('fail')
      return
    }

    if (!paymentKey || !orderId) { setStatus('fail'); return }

    fetch('/api/billing/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (res.ok && data?.ok) {
          setExpiresAt(typeof data.planExpiresAt === 'string' ? data.planExpiresAt : null)
          setStatus('success')
          setPlanRefreshKey(k => k + 1)
          return
        }
        setFailMessage(typeof data?.message === 'string' ? data.message : null)
        setStatus('fail')
      })
      .catch(() => setStatus('fail'))
  }, [paymentKey, orderId, amount, failFlag, failCode, failMessageParam])

  const paymentResult = (((translations as Record<string, any>)[locale]?.paymentResult) ?? translations.en.paymentResult) as typeof translations.ko.paymentResult
  const billingResult = (((translations as Record<string, any>)[locale]?.billingResult) ?? translations.en.billingResult) as typeof translations.ko.billingResult
  const subscribeSuccess = (((translations as Record<string, any>)[locale]?.subscribeSuccess) ?? translations.en.subscribeSuccess) as typeof translations.ko.subscribeSuccess

  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleDateString(dateLocale) : ''

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
    status === 'success' ? paymentResult.successTitle
      : status === 'canceled' ? paymentResult.canceledTitle
        : paymentResult.failTitle
  const desc =
    status === 'success' ? (expiresLabel ? t('paymentResult.successDesc', { date: expiresLabel }) : null)
      : status === 'canceled' ? paymentResult.canceledDesc
        : failMessage

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack planRefreshKey={planRefreshKey} />

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px' }}>
        {status === 'loading' ? (
          <div style={card}>
            <CreditCard size={28} style={{ color: 'var(--text-tertiary)' }} />
            <div style={descStyle}>{paymentResult.confirming}</div>
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

export default function PaymentResultPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />}>
      <PaymentResultContent />
    </Suspense>
  )
}
