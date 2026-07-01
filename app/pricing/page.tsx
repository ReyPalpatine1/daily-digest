'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { supabase, getPlanView } from '@/lib/supabase'
import type { Profile, PlanView } from '@/lib/supabase'
import { AppHeader } from '@/components/AppHeader'
import { UpgradeButton } from '@/components/UpgradeButton'
import { Check, X, ChevronUp, ChevronDown } from 'lucide-react'

const PRICE_MONTHLY = 4900

export default function PricingPage() {
  const router = useRouter()
  const { locale } = useTranslation()
  const [planView, setPlanView] = useState<PlanView>('free')
  const [ready, setReady] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      if (!data.user) { setReady(true); return }

      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      const admin = adminEmails.includes((data.user.email ?? '').toLowerCase())
      let adminPreviewPro = false
      if (admin) {
        try { adminPreviewPro = localStorage.getItem('admin_plan_mode') === 'pro' } catch {}
      }

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      if (cancelled) return

      const profile = profileRow as Profile | null
      const effectiveAdmin = admin ? adminPreviewPro : false
      setPlanView(getPlanView(profile, effectiveAdmin))
      setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  const won = (n: number) => `₩${n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')}`
  const pricing = (((translations as Record<string, any>)[locale]?.pricing) ?? translations.en.pricing) as typeof translations.ko.pricing

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 14,
    padding: 24,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  }
  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '11px 16px', borderRadius: 9, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-card)',
    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
  const disabledBtn: React.CSSProperties = {
    width: '100%', padding: '11px 16px', borderRadius: 9, border: '0.5px solid var(--border)',
    background: 'var(--bg-subtle)', color: 'var(--text-muted)',
    fontSize: 14, fontWeight: 600, cursor: 'default', fontFamily: 'inherit',
  }
  // 버튼 아래 캡션 한 줄 자리(높이 고정) — Free/Pro 카드 버튼 상단 y좌표를 항상 맞추기 위해
  // planView와 무관하게 항상 렌더(내용 없으면 빈 자리만 차지).
  const captionSlot: React.CSSProperties = {
    height: 15, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
  }

  const featureRow = (label: string, included: boolean) => (
    <div key={label} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0', fontSize: 13,
      color: included ? 'var(--text-secondary)' : 'var(--text-muted)',
    }}>
      {included
        ? <Check size={15} strokeWidth={2.5} style={{ flexShrink: 0, color: 'var(--text-primary)' }} />
        : <X size={15} strokeWidth={2.5} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />}
      {label}
    </div>
  )

  function proCardButton() {
    if (!ready) return (
      <>
        <button style={disabledBtn} disabled>···</button>
        <div style={captionSlot} />
      </>
    )
    if (planView === 'pro') return (
      <>
        <button style={disabledBtn} disabled>{pricing.currentInUse}</button>
        <div style={captionSlot} />
      </>
    )
    if (planView === 'trialing') return (
      <>
        <button style={disabledBtn} disabled>{pricing.payComingSoon}</button>
        <div style={captionSlot}>{pricing.trialActive}</div>
      </>
    )
    if (planView === 'trial_expired') return (
      <>
        <UpgradeButton label={pricing.subscribePro} onClick={() => router.push('/subscribe?mode=pay')} style={{ ...primaryBtn }} />
        <div style={captionSlot} />
      </>
    )
    return (
      <>
        <UpgradeButton label={pricing.startTrial} onClick={() => router.push('/subscribe?mode=trial')} style={{ ...primaryBtn }} />
        <div style={captionSlot} />
      </>
    )
  }

  const freeBtnLabel = !ready ? '···' : planView !== 'free' ? pricing.basePlan : pricing.currentInUse

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack />

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 64px' }}>
        {/* 헤더 */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>
            {pricing.title}
          </h1>
        </div>

        {/* 플랜 카드 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16, marginBottom: 40,
          alignItems: 'stretch',
        }}>
          {/* Free */}
          <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{pricing.free}</div>
            <div style={{ marginTop: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{pricing.freePriceLabel}</span>
            </div>
            <div style={{ flex: 1, marginBottom: 18 }}>
              {pricing.freeFeatures.map(f => featureRow(f, true))}
              {pricing.freeExcluded.map(f => featureRow(f, false))}
            </div>
            <div style={{ marginTop: 'auto' }}>
              <button style={disabledBtn} disabled>{freeBtnLabel}</button>
              <div style={captionSlot} />
            </div>
          </div>

          {/* Pro */}
          <div style={{
            ...card,
            border: '1px solid var(--accent)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{pricing.pro}</span>
              <span style={{
                fontSize: 11, fontWeight: 600,
                background: 'var(--accent)', color: 'var(--bg-card)',
                padding: '2px 8px', borderRadius: 5,
              }}>{pricing.recommended}</span>
            </div>
            <div style={{ marginTop: 10, marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>
                {won(PRICE_MONTHLY)}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>
                {pricing.perMonth}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
              {pricing.payNote}
            </div>
            <div style={{ flex: 1, marginBottom: 18 }}>
              {pricing.proFeatures.map(f => featureRow(f, true))}
            </div>
            <div style={{ marginTop: 'auto' }}>
              {proCardButton()}
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 14 }}>{pricing.faqTitle}</h2>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {pricing.faq.map((item, i) => {
              const open = openFaq === i
              return (
                <div key={i} style={{ borderBottom: i < pricing.faq.length - 1 ? '0.5px solid var(--border-light)' : 'none' }}>
                  <button onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                      padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
                    }}>
                    <span>Q. {item.q}</span>
                    {open
                      ? <ChevronUp size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      : <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                  </button>
                  {open && (
                    <div style={{
                      padding: '0 16px 16px', fontSize: 13,
                      color: 'var(--text-secondary)', lineHeight: 1.7,
                    }}>
                      {item.a}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
