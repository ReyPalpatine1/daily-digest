'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'

type Tab = 'account' | 'subscription' | 'help'

const ONETIME_PLANS = [
  { id: '1month', key: 'onetime1', amount: 4900, discount: 0 },
  { id: '3month', key: 'onetime3', amount: 12000, discount: 18 },
  { id: '6month', key: 'onetime6', amount: 24000, discount: 18 },
  { id: '1year', key: 'onetime12', amount: 39000, discount: 33 },
]

export default function ProfilePage() {
  const router = useRouter()
  const { t, locale } = useTranslation()

  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminPreviewPro, setAdminPreviewPro] = useState(false)

  const [activeTab, setActiveTab] = useState<Tab>('account')
  const [selectedOnetime, setSelectedOnetime] = useState('1month')
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    // URL 쿼리(?tab=help)로 초기 탭 지정
    try {
      const tab = new URLSearchParams(window.location.search).get('tab')
      if (tab === 'subscription' || tab === 'help' || tab === 'account') {
        setActiveTab(tab)
      }
    } catch {}

    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      setUser(data.user)

      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      const admin = adminEmails.includes((data.user.email ?? '').toLowerCase())
      setIsAdmin(admin)
      if (admin) {
        try { setAdminPreviewPro(localStorage.getItem('admin_plan_mode') === 'pro') } catch {}
      }

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      if (cancelled) return

      setProfile(profileRow as Profile | null)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const won = (n: number) => `₩${n.toLocaleString(dateLocale)}`

  // 플랜 판정 (대시보드와 동일: 관리자는 미리보기 토글 우선)
  const realIsPro = checkIsPro(profile, isAdmin)
  const isPro = isAdmin ? adminPreviewPro : realIsPro
  const isVip = profile?.plan === 'vip'
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // 대시보드 인사말과 같은 이름 소스
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
  const joinedAt = user?.created_at ? new Date(user.created_at).toLocaleDateString(dateLocale) : '—'

  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim()).filter(Boolean)[0] || 'help@daily-digest.app'

  const nextBillingDate = new Date(Date.now() + 23 * 86_400_000).toLocaleDateString(dateLocale)

  // 결제 기능은 아직 미구현 — 모든 결제 액션은 안내만
  function comingSoon() {
    setToast(t('profile.paymentComingSoon'))
    setTimeout(() => setToast(''), 2500)
  }

  // === 공용 스타일 ===
  const planBadgeStyle = (p: 'FREE' | 'PRO'): React.CSSProperties =>
    p === 'PRO'
      ? {
          background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)',
          color: '#FFFFFF',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          padding: '2px 7px', borderRadius: 4,
        }
      : {
          background: 'var(--bg-subtle)',
          color: 'var(--text-tertiary)',
          fontSize: 10, fontWeight: 600, letterSpacing: 0.4,
          padding: '2px 7px', borderRadius: 4,
        }
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
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500,
    background: active ? 'var(--bg-card)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
  })

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  const billingHistory = isPro
    ? [
        { date: new Date(Date.now() - 7 * 86_400_000).toLocaleDateString(dateLocale), label: t('subscribe.proMonthly'), amount: 4900 },
        { date: new Date(Date.now() - 37 * 86_400_000).toLocaleDateString(dateLocale), label: t('subscribe.proMonthly'), amount: 4900 },
      ]
    : []

  const faqs = [1, 2, 3, 4, 5].map(i => ({
    q: t(`profile.faq${i}Q`),
    a: t(`profile.faq${i}A`),
  }))

  const accountRow = (label: string, value: React.ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 0', borderBottom: '0.5px solid var(--border-light)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)', minWidth: 72 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )

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
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 18px', letterSpacing: -0.4 }}>
          {t('profile.title')}
        </h1>

        {/* === 탭 === */}
        <div style={{
          display: 'inline-flex', background: 'var(--bg-subtle)',
          borderRadius: 9, padding: 3, marginBottom: 20,
        }}>
          <button style={tabBtn(activeTab === 'account')} onClick={() => setActiveTab('account')}>
            {t('profile.tabAccount')}
          </button>
          <button style={tabBtn(activeTab === 'subscription')} onClick={() => setActiveTab('subscription')}>
            {t('profile.tabSubscription')}
          </button>
          <button style={tabBtn(activeTab === 'help')} onClick={() => setActiveTab('help')}>
            {t('profile.tabHelp')}
          </button>
        </div>

        {/* ============ 탭1: 내 계정 ============ */}
        {activeTab === 'account' && (
          <div style={card$}>
            {accountRow(t('profile.name'), userName)}
            {accountRow(t('profile.email'), user?.email ?? '—')}
            {accountRow(t('profile.joinedAt'), joinedAt)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0 1px' }}>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)', minWidth: 72 }}>{t('profile.planLabel')}</span>
              <span style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <span style={planBadgeStyle(plan)}>{plan}</span>
              </span>
            </div>
          </div>
        )}

        {/* ============ 탭2: 구독 ============ */}
        {activeTab === 'subscription' && (
          <>
            {/* 현재 플랜 */}
            <div style={{ ...card$, marginBottom: 14 }}>
              <div style={sectionTitle}>{t('subscription.currentPlan')}</div>
              {isVip ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>👑 {t('subscription.vipTitle')}</span>
                    <span style={{
                      background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
                      color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                      padding: '2px 7px', borderRadius: 4,
                    }}>PRO</span>
                  </div>
                  <div style={{
                    background: 'var(--bg-subtle)', borderRadius: 10, padding: 14,
                    fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
                  }}>
                    {t('subscription.vipDesc')}
                  </div>
                </>
              ) : isPro ? (
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
                    <button style={btnSecondary} onClick={comingSoon}>
                      {t('subscription.changePlan')}
                    </button>
                    <button style={btnSecondary} onClick={comingSoon}>
                      {t('subscription.changePayment')}
                    </button>
                    <button
                      style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={comingSoon}>
                      {t('subscription.cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>
                    {t('subscription.freePlanLabel')}
                  </div>
                  <div style={{ background: 'var(--bg-subtle)', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                      {t('subscription.freeUpgradePrompt')}
                    </div>
                    <button onClick={comingSoon}
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

            {/* 결제 내역 (Pro만) */}
            {isPro && (
              <div style={{ ...card$, marginBottom: 14 }}>
                <div style={sectionTitle}>{t('subscription.billingHistory')}</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {billingHistory.map((h, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
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
                <button onClick={comingSoon} style={{ ...btnSecondary, marginTop: 10 }}>
                  {t('subscription.viewReceipt')}
                </button>
              </div>
            )}

            {/* 일회성 구매 (VIP 제외) */}
            {!isVip && (
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
                          <span style={{ fontSize: 10, color: 'var(--success)', fontWeight: 600 }}>-{p.discount}%</span>
                        )}
                      </label>
                    )
                  })}
                </div>
                <button onClick={comingSoon}
                  style={{
                    width: '100%', padding: '11px 16px', borderRadius: 9, border: 'none',
                    background: 'var(--accent)', color: 'var(--bg-card)',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {t('subscription.buySelected')}
                </button>
              </div>
            )}
          </>
        )}

        {/* ============ 탭3: 도움말 ============ */}
        {activeTab === 'help' && (
          <div style={card$}>
            {faqs.map((f, i) => {
              const open = openFaq === i
              return (
                <div key={i} style={{
                  borderBottom: i < faqs.length - 1 ? '0.5px solid var(--border-light)' : 'none',
                }}>
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                      cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)',
                      fontSize: 13, fontWeight: 500, padding: '14px 0',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                    <span style={{ flex: 1 }}>{f.q}</span>
                    <span style={{
                      color: 'var(--text-tertiary)', fontSize: 12,
                      transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
                    }}>▾</span>
                  </button>
                  {open && (
                    <div style={{
                      fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65,
                      padding: '0 0 14px',
                    }}>
                      {f.a}
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{
              marginTop: 16, paddingTop: 14, borderTop: '0.5px solid var(--border-light)',
              fontSize: 12, color: 'var(--text-tertiary)',
            }}>
              {t('profile.contact')}: {adminEmail}
            </div>
          </div>
        )}
      </main>

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
