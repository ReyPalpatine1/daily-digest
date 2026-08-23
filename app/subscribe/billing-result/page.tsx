'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { AppHeader } from '@/components/AppHeader'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Spinner } from '@/components/Spinner'

// 토스 카드 등록창의 리다이렉트 착지점.
// 성공: ?customerKey=&authKey= → /api/billing/authorize 로 넘겨 빌링키를 발급받는다.
// 실패: ?fail=1 또는 ?code=&message= (사용자가 창을 닫으면 code=USER_CANCEL).
//
// ?intent= 로 등록 이후 흐름이 갈린다.
//   subscribe : 등록에 이어 바로 결제한다(/api/billing/charge)
//   card      : 카드만 교체한다 — 결제하지 않는다(/profile의 카드 변경)

type Status =
  | 'loading'       // 빌링키 발급 중
  | 'charging'      // 카드 등록 완료, 결제 진행 중
  | 'paid'          // 결제까지 완료
  | 'alreadyActive' // 카드는 등록됐고, 이미 이용 중이라 결제하지 않음
  | 'cardChanged'   // 카드만 교체
  | 'chargeFailed'  // 카드는 등록됐으나 결제 실패
  | 'fail'          // 카드 등록 자체 실패
  | 'canceled'      // 사용자가 창을 닫음

function BillingResultContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale } = useTranslation()

  const [status, setStatus] = useState<Status>('loading')
  const [failMessage, setFailMessage] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  // 헤더는 진입 시점(결제 전) 프로필을 들고 있다 — 승인 뒤 이 값을 올려 다시 읽게 한다.
  // 그러지 않으면 "결제가 완료되었습니다" 옆에서 뱃지만 FREE로 남는다.
  const [planRefreshKey, setPlanRefreshKey] = useState(0)
  // 개발 모드의 이펙트 2회 실행으로 authKey가 두 번 소비되지 않게 한다.
  const startedRef = useRef(false)

  const authKey = searchParams.get('authKey')
  const customerKey = searchParams.get('customerKey')
  const intent = searchParams.get('intent') === 'card' ? 'card' : 'subscribe'
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

    async function run() {
      const res = await fetch('/api/billing/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey, customerKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setFailMessage(typeof data?.message === 'string' ? data.message : null)
        setStatus('fail')
        return
      }

      // 카드 변경 흐름은 여기서 끝난다 — 결제하지 않는다.
      if (intent === 'card') { setStatus('cardChanged'); return }

      setStatus('charging')
      const chargeRes = await fetch('/api/billing/charge', { method: 'POST' })
      const charge = await chargeRes.json().catch(() => ({}))
      if (chargeRes.ok && charge?.ok) {
        setExpiresAt(typeof charge.planExpiresAt === 'string' ? charge.planExpiresAt : null)
        setStatus('paid')
        setPlanRefreshKey(k => k + 1)
        return
      }
      // 이미 이용 중이면 중복 청구를 막은 것이므로 오류가 아니다.
      if (chargeRes.status === 409) { setStatus('alreadyActive'); return }
      setFailMessage(
        charge?.error === 'no_card'
          ? t('billingResult.noCard')
          : (typeof charge?.message === 'string' ? charge.message : null)
      )
      setStatus('chargeFailed')
    }
    run().catch(() => setStatus('fail'))
  }, [authKey, customerKey, intent, failFlag, failCode, failMessageParam, t])

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
  // 대기 안내 — 승인 도중 창을 닫으면 결제 상태가 어긋날 수 있어 눈에 띄되 과하지 않게.
  const waitNoticeStyle: React.CSSProperties = {
    fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginTop: 6,
  }

  const isDone = status === 'paid' || status === 'alreadyActive' || status === 'cardChanged'

  const title =
    status === 'paid' ? billingResult.paidTitle
      : status === 'cardChanged' ? billingResult.cardChangedTitle
        : status === 'alreadyActive' ? billingResult.successTitle
          : status === 'chargeFailed' ? billingResult.chargeFailedTitle
            : status === 'canceled' ? billingResult.canceledTitle
              : billingResult.failTitle
  const desc =
    status === 'paid' ? (expiresLabel ? t('billingResult.paidDesc', { date: expiresLabel }) : null)
      : status === 'cardChanged' ? billingResult.cardChangedDesc
        : status === 'alreadyActive' ? billingResult.alreadyActiveDesc
          : status === 'canceled' ? billingResult.canceledDesc
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
        {status === 'loading' || status === 'charging' ? (
          /* 대기 표시는 진입 즉시 보여준다 — usePending의 200ms 지연을 쓰지 않는다.
             그 지연은 "금방 끝날 수도 있는" 버튼의 깜빡임을 막는 장치인데,
             이 화면은 토스 승인 → DB 기록 → 플랜 반영으로 왕복이 두 번 이상이라
             1~2초가 확실히 걸린다. 늦게 띄우면 그 사이가 "멈춘 화면"으로 보인다. */
          <div style={card}>
            <Spinner color="var(--success)" />
            {/* 카드 등록이 끝난 뒤 결제를 기다리는 동안 무엇이 진행 중인지 밝힌다. */}
            <h1 style={titleStyle}>
              {status === 'charging' ? billingResult.successTitle : billingResult.registering}
            </h1>
            {status === 'charging' && <div style={descStyle}>{billingResult.successDesc}</div>}
            <div style={waitNoticeStyle}>{billingResult.waitNotice}</div>
          </div>
        ) : (
          <>
            <div style={{ ...card, marginBottom: 16 }}>
              {isDone
                ? <CheckCircle2 size={30} style={{ color: 'var(--success)' }} />
                : <XCircle size={30} style={{ color: status === 'canceled' ? 'var(--text-tertiary)' : 'var(--danger)' }} />}
              <h1 style={titleStyle}>{title}</h1>
              {desc && <div style={descStyle}>{desc}</div>}
            </div>

            {isDone ? (
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
