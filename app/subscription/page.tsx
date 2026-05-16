'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'

const ONETIME_PLANS = [
  { id: '1month', key: 'onetime1', amount: 4900, discount: 0 },
  { id: '3month', key: 'onetime3', amount: 12000, discount: 18 },
  { id: '6month', key: 'onetime6', amount: 24000, discount: 18 },
  { id: '1year', key: 'onetime12', amount: 39000, discount: 33 },
]

export default function SubscriptionPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [ready, setReady] = useState(false)
  const [isPro, setIsPro] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [selectedOnetime, setSelectedOnetime] = useState('1month')

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      try { setIsPro(localStorage.getItem('demo_pro') === 'true') } catch {}
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  const won = (n: number) => `₩${n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')}`
  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const nextBillingDate = new Date(Date.now() + 23 * 86_400_000).toLocaleDateString(dateLocale)
  const proEndDate = nextBillingDate

  const card$: React.CSSProperties = {
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    borderRadius: 12, padding: 18, boxSizing: 'border-box',
  }
  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10 }
  const btnSecondary: React.CSSProperties = {
    padding: '7px 12px', borderRadius: 7, border: '0.5px solid var(--border)',
    background: 'var(--bg-card)', color: 'var(--text-secondary)',
    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  }

  function confirmCancel() {
    try { localStorage.setItem('demo_pro', 'false') } catch {}
    console.log('[phase8] subscription canceled (demo)')
    setIsPro(false)
    setCancelOpen(false)
    setToast(t('subscription.canceledToast'))
    setTimeout(() => setToast(''), 2500)
  }

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  // 데모용 결제 내역
  const billingHistory = isPro
    ? [
        { date: new Date(Date.now() - 7 * 86_400_000).toLocaleDateString(dateLocale), label: t('subscribe.proMonthly'), amount: 4900, status: 'done' },
        { date: new Date(Date.now() - 37 * 86_400_000).toLocaleDateString(dateLocale), label: t('subscribe.proMonthly'), amount: 4900, status: 'done' },
      ]
    : []

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
        <button onClick={() => router.push('/dashboard')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'inherit' }}>
          {t('subscribe.back')}
        </button>
      </header>

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 56px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 20px', letterSpacing: -0.4 }}>
          {t('subscription.title')}
        </h1>

        {/* === 현재 플랜 === */}
        <div style={{ ...card$, marginBottom: 14 }}>
          <div style={sectionTitle}>{t('subscription.currentPlan')}</div>
          {isPro ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>✨ Pro</span>
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{won(4900)} {t('pricing.perMonth')}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {t('subscription.nextBilling')}: <strong style={{ color: 'var(--text-primary)' }}>{nextBillingDate}</strong>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                {t('subscription.paymentMethod')}: <strong style={{ color: 'var(--text-primary)' }}>{t('subscription.cardMasked')}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={btnSecondary} onClick={() => { console.log('[phase8] change plan'); router.push('/pricing') }}>
                  {t('subscription.changePlan')}
                </button>
                <button style={btnSecondary} onClick={() => console.log('[phase8] change payment method')}>
                  {t('subscription.changePayment')}
                </button>
                <button
                  style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={() => setCancelOpen(true)}>
                  {t('subscription.cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>
                {t('subscription.freePlanLabel')}
              </div>
              <div style={{
                background: 'var(--bg-subtle)', borderRadius: 10, padding: 14,
              }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {t('subscription.freeUpgradePrompt')}
                </div>
                <button onClick={() => router.push('/pricing')}
                  style={{
                    padding: '9px 14px', borderRadius: 8, border: 'none',
                    background: 'var(--accent)', color: 'var(--bg-card)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {t('subscription.startProCta')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* === 결제 내역 (Pro만) === */}
        {isPro && (
          <div style={{ ...card$, marginBottom: 14 }}>
            <div style={sectionTitle}>{t('subscription.billingHistory')}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {billingHistory.map((h, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 0',
                  borderBottom: i < billingHistory.length - 1 ? '0.5px solid var(--border-light)' : 'none',
                  fontSize: 12,
                }}>
                  <span style={{ color: 'var(--text-tertiary)', minWidth: 84 }}>{h.date}</span>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{h.label}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{won(h.amount)}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                    background: 'var(--bg-subtle)', color: 'var(--text-tertiary)',
                  }}>{t('subscription.statusDone')}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => console.log('[phase8] view receipt')}
              style={{ ...btnSecondary, marginTop: 10 }}>
              {t('subscription.viewReceipt')}
            </button>
          </div>
        )}

        {/* === 일회성 구매 === */}
        <div style={card$}>
          <div style={sectionTitle}>{t('subscription.onetimeTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            {t('subscription.onetimeDesc')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {ONETIME_PLANS.map(p => {
              const sel = selectedOnetime === p.id
              return (
                <label key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `0.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                    background: sel ? 'var(--bg-subtle)' : 'var(--bg-card)',
                  }}
                  onClick={() => setSelectedOnetime(p.id)}>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    border: `0.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                    background: sel ? 'var(--accent)' : 'var(--bg-card)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {sel && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bg-card)' }} />}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                    {t(`subscription.${p.key}`)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{won(p.amount)}</span>
                  {p.discount > 0 && (
                    <span style={{
                      fontSize: 10, color: 'var(--success)', fontWeight: 600,
                    }}>-{p.discount}%</span>
                  )}
                </label>
              )
            })}
          </div>
          <button
            onClick={() => router.push(`/subscribe?type=onetime&plan=${selectedOnetime}`)}
            style={{
              width: '100%', padding: '11px 16px', borderRadius: 9, border: 'none',
              background: 'var(--accent)', color: 'var(--bg-card)',
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {t('subscription.buySelected')}
          </button>
        </div>
      </main>

      {/* === 해지 모달 === */}
      {cancelOpen && (
        <div
          onClick={() => setCancelOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', borderRadius: 14,
              border: '0.5px solid var(--border)',
              padding: 22, width: '100%', maxWidth: 360,
              boxShadow: 'var(--shadow-lg)',
            }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              {t('subscription.cancelTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('subscription.cancelIntro')}
            </div>
            <ul style={{ margin: '0 0 18px', paddingLeft: 18 }}>
              {[
                t('subscription.cancelEffect1'),
                t('subscription.cancelEffect2', { date: proEndDate }),
                t('subscription.cancelEffect3'),
              ].map((line, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.6 }}>
                  {line}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setCancelOpen(false)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  border: '0.5px solid var(--border)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {t('subscription.keepUsing')}
              </button>
              <button onClick={confirmCancel}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                  background: 'var(--danger)', color: '#fff',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {t('subscription.confirmCancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === 토스트 === */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
          padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
