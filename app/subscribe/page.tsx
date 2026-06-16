'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'

const ONETIME_AMOUNTS: Record<string, number> = {
  '1month': 4900,
  '3month': 12000,
  '6month': 24000,
  '1year': 39000,
}

function SubscribeInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const { t, locale } = useTranslation()

  const isOnetime = sp.get('type') === 'onetime'
  const plan = sp.get('plan') ?? (isOnetime ? '1month' : 'monthly')

  const amount = isOnetime
    ? (ONETIME_AMOUNTS[plan] ?? 4900)
    : (plan === 'yearly' ? 39000 : 4900)

  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreeAutoPay, setAgreeAutoPay] = useState(false)
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '', holder: '' })

  const won = (n: number) => `₩${n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')}`
  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const billingDate = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString(dateLocale)

  const planLabel = isOnetime
    ? `${t('subscribe.onetime')} · ${plan}`
    : plan === 'yearly' ? t('subscribe.proYearly') : t('subscribe.proMonthly')

  const card$: React.CSSProperties = {
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    borderRadius: 12, padding: 18, boxSizing: 'border-box',
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    borderRadius: 7, padding: '9px 12px', fontSize: 14,
    color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 5,
  }

  function submit() {
    if (!agreeTerms || (!isOnetime && !agreeAutoPay)) {
      alert(t('subscribe.needAgree'))
      return
    }
    // 데모 — 실제 결제 없음. demo_pro 플래그만 활성화.
    console.log('[phase8] demo checkout', { isOnetime, plan, amount, card })
    try { localStorage.setItem('demo_pro', 'true') } catch {}
    router.push(`/subscribe/success?type=${isOnetime ? 'onetime' : 'sub'}&plan=${plan}`)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
    }}>
      <header style={{
        height: 56, borderBottom: '0.5px solid var(--border)', background: 'var(--bg-card)',
        display: 'flex', alignItems: 'center', padding: '0 20px',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.push('/pricing')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'inherit' }}>
          {t('subscribe.back')}
        </button>
      </header>

      <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 56px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 20px', letterSpacing: -0.4 }}>
          {t('subscribe.title')}
        </h1>

        {/* 선택한 플랜 */}
        <div style={{ ...card$, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {t('subscribe.selectedPlan')}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{planLabel}</span>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>{won(amount)}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
            {isOnetime
              ? t('subscribe.onetimeNotice')
              : `${t('subscribe.firstWeekFree')} · ${t('subscribe.billingStarts', { date: billingDate })}`}
          </div>
        </div>

        {/* 결제 수단 */}
        <div style={{ ...card$, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{t('subscribe.paymentMethod')}</div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>{t('subscribe.paymentMethod')}</label>
            <select style={inputStyle} defaultValue="credit">
              <option value="credit">{t('subscribe.creditCard')}</option>
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>{t('subscribe.cardNumber')}</label>
            <input style={inputStyle} inputMode="numeric" placeholder="____ ____ ____ ____"
              value={card.number} onChange={e => setCard({ ...card, number: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('subscribe.expiry')}</label>
              <input style={inputStyle} placeholder="MM/YY"
                value={card.expiry} onChange={e => setCard({ ...card, expiry: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('subscribe.cvc')}</label>
              <input style={inputStyle} inputMode="numeric" placeholder="CVC"
                value={card.cvc} onChange={e => setCard({ ...card, cvc: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('subscribe.cardHolder')}</label>
            <input style={inputStyle}
              value={card.holder} onChange={e => setCard({ ...card, holder: e.target.value })} />
          </div>
        </div>

        {/* 약관 동의 */}
        <div style={{ ...card$, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { key: 'terms', label: t('subscribe.agreeTerms'), checked: agreeTerms, set: setAgreeTerms, show: true },
            { key: 'autopay', label: t('subscribe.agreeAutoPay'), checked: agreeAutoPay, set: setAgreeAutoPay, show: !isOnetime },
          ].filter(c => c.show).map(c => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13 }}>
              <span onClick={() => c.set(!c.checked)} style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                border: '0.5px solid var(--border)',
                background: c.checked ? 'var(--accent)' : 'var(--bg-card)',
                color: 'var(--bg-card)', fontSize: 11, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{c.checked ? '✓' : ''}</span>
              {c.label}
            </label>
          ))}
        </div>

        <button onClick={submit}
          style={{
            width: '100%', padding: '13px 16px', borderRadius: 10, border: 'none',
            background: 'var(--accent)', color: 'var(--bg-card)',
            fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {isOnetime ? t('subscribe.payCta') : t('subscribe.startTrialCta')}
        </button>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          🔒 {t('subscribe.secureNote')}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {t('subscribe.demoNotice')}
        </div>
      </main>
    </div>
  )
}

export default function SubscribePage() {
  const router = useRouter()
  // 옛 결제폼(/subscribe)은 비활성 — 결제 진입은 /pricing으로 일원화.
  // SubscribeInner 코드는 보존하되 렌더하지 않고 /pricing으로 리다이렉트.
  useEffect(() => { router.replace('/pricing') }, [router])
  return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
}
