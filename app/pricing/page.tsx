'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { AppHeader } from '@/components/AppHeader'
import { UpgradeButton } from '@/components/UpgradeButton'
import { Check, X, ChevronUp, ChevronDown } from 'lucide-react'

const PRICE_MONTHLY = 4900

export default function PricingPage() {
  const { t, locale } = useTranslation()
  const [isPro, setIsPro] = useState(false)
  const [ready, setReady] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [toastKey, setToastKey] = useState<string | null>(null)

  // 실제 DB 플랜으로 Pro 판정 (profile 페이지와 동일 규칙).
  // 로드 전엔 ready=false로 버튼 판정 보류 → 깜빡임 방지.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      if (!data.user) { setReady(true); return } // 비로그인 → FREE 취급

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

      const realIsPro = checkIsPro(profileRow as Profile | null, admin)
      setIsPro(admin ? adminPreviewPro : realIsPro)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  // 실결제 미구현 — 모든 결제 진입은 안내만 (profile 페이지와 동일 패턴)
  function comingSoon() {
    setToastKey('profile.paymentComingSoon')
    setTimeout(() => setToastKey(null), 2500)
  }

  const won = (n: number) => `₩${n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')}`
  // zh/ja는 아직 번역이 없어 en으로 폴백 (타입은 ko 기준으로 고정)
  const pricing = (((translations as Record<string, any>)[locale]?.pricing) ?? translations.en.pricing) as typeof translations.ko.pricing

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 14,
    padding: 24,
    boxSizing: 'border-box',
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

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* 상단바 */}
      <AppHeader showBack />

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 64px' }}>
        {/* 헤더 */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>
            {pricing.title}
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-tertiary)', marginTop: 10 }}>
            {pricing.subtitle}
          </p>
        </div>

        {/* 플랜 카드 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16, marginBottom: 32,
        }}>
          {/* Free */}
          <div style={card}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{pricing.free}</div>
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{pricing.freePriceLabel}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 18 }}>
              {pricing.freeSub}
            </div>
            <div style={{ marginBottom: 18 }}>
              {pricing.freeFeatures.map(f => featureRow(f, true))}
              {pricing.freeExcluded.map(f => featureRow(f, false))}
            </div>
            <button style={disabledBtn} disabled>
              {!ready ? '⋯' : isPro ? pricing.basePlan : pricing.currentInUse}
            </button>
          </div>

          {/* Pro */}
          <div style={{
            ...card,
            border: '1px solid var(--accent)',
            boxShadow: 'var(--shadow-lg)',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{pricing.pro}</span>
              <span style={{
                fontSize: 11, fontWeight: 600,
                background: 'var(--accent)', color: 'var(--bg-card)',
                padding: '2px 8px', borderRadius: 5,
              }}>{pricing.recommended}</span>
            </div>
            <div style={{ marginTop: 10, marginBottom: 18, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>
                {won(PRICE_MONTHLY)}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>
                {pricing.perMonth}
              </span>
            </div>
            <div style={{ marginBottom: 18 }}>
              {pricing.proFeatures.map(f => featureRow(f, true))}
            </div>
            {!ready ? (
              <button style={disabledBtn} disabled>⋯</button>
            ) : isPro ? (
              <button style={disabledBtn} disabled>{pricing.currentInUse}</button>
            ) : (
              <UpgradeButton
                label={pricing.startTrial}
                onClick={comingSoon}
                style={{ ...primaryBtn }} />
            )}
          </div>
        </div>

        {/* 결제 방식 안내 (자동 갱신 / 일회성) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16, marginBottom: 40,
        }}>
          {[
            { title: pricing.autoRenewTitle, desc: pricing.autoRenewDesc },
            { title: pricing.onetimePassTitle, desc: pricing.onetimePassDesc },
          ].map(box => (
            <button
              key={box.title}
              onClick={comingSoon}
              style={{
                ...card, textAlign: 'left', cursor: 'pointer',
                borderRadius: 10, padding: 16,
              }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{box.title}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.6 }}>
                {box.desc}
              </span>
            </button>
          ))}
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

      {/* === 토스트 === */}
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
