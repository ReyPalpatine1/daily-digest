'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'

const ONETIME_AMOUNTS: Record<string, number> = {
  '1month': 4900,
  '3month': 12000,
  '6month': 24000,
  '1year': 39000,
}

function SuccessInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const { t, locale } = useTranslation()

  const isOnetime = sp.get('type') === 'onetime'
  const plan = sp.get('plan') ?? (isOnetime ? '1month' : 'monthly')
  const amount = isOnetime
    ? (ONETIME_AMOUNTS[plan] ?? 4900)
    : (plan === 'yearly' ? 39000 : 4900)

  const won = (n: number) => `₩${n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')}`
  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const billingDate = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString(dateLocale)

  const infoRow = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        {/* 성공 아이콘 */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'var(--success)', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, fontWeight: 700, marginBottom: 18,
        }}>✓</div>

        <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>
          {isOnetime ? t('subscribeSuccess.onetimeTitle') : t('subscribeSuccess.title')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginTop: 8, marginBottom: 22 }}>
          {isOnetime ? t('subscribeSuccess.onetimeDesc') : t('subscribeSuccess.desc')}
        </p>

        {/* 정보 박스 */}
        <div style={{
          background: 'var(--bg-subtle)', borderRadius: 10,
          padding: 16, marginBottom: 22, textAlign: 'left',
        }}>
          {!isOnetime && infoRow(t('subscribeSuccess.trialEnd'), billingDate)}
          {!isOnetime && infoRow(t('subscribeSuccess.firstBilling'), billingDate)}
          {infoRow(t('subscribeSuccess.amount'), won(amount))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => router.push('/dashboard')}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
              background: 'var(--accent)', color: 'var(--bg-card)',
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {t('subscribeSuccess.goDashboard')}
          </button>
          <button onClick={() => router.push('/subscription')}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 10,
              border: '0.5px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {t('subscribeSuccess.manage')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SubscribeSuccessPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />}>
      <SuccessInner />
    </Suspense>
  )
}
