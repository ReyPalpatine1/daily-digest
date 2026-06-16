'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AppHeader } from '@/components/AppHeader'
import { UpgradeButton } from '@/components/UpgradeButton'

export default function ProfilePage() {
  const router = useRouter()
  const { t, locale } = useTranslation()

  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminPreviewPro, setAdminPreviewPro] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
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

  // 플랜 판정 (대시보드와 동일: 관리자는 미리보기 토글 우선)
  const realIsPro = checkIsPro(profile, isAdmin)
  const isPro = isAdmin ? adminPreviewPro : realIsPro
  const isVip = profile?.plan === 'vip'
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // 대시보드 인사말과 같은 이름 소스
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
  const joinedAt = user?.created_at ? new Date(user.created_at).toLocaleDateString(dateLocale) : null

  // Pro 만료일: VIP(무기한)거나 만료일 없으면 '만료 없음', 그 외엔 날짜
  const expiresLabel = isVip || !profile?.plan_expires_at
    ? t('profile.noExpiry')
    : new Date(profile.plan_expires_at).toLocaleDateString(dateLocale)

  // 결제 기능은 아직 미구현 — 결제/구독 관리 액션은 안내만
  function comingSoon() {
    setToast(t('profile.paymentComingSoon'))
    setTimeout(() => setToast(''), 2500)
  }

  // === 공용 스타일 ===
  // 플랜명 강조 뱃지 (플랜 카드 핵심 표시) — 앱 공통 색 체계 유지
  const planBadgeStyle = (p: 'FREE' | 'PRO'): React.CSSProperties =>
    p === 'PRO'
      ? {
          display: 'inline-block',
          background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)',
          color: '#FFFFFF',
          fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
          padding: '4px 11px', borderRadius: 6,
        }
      : {
          display: 'inline-block',
          background: 'var(--bg-subtle)',
          color: 'var(--text-secondary)',
          fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
          padding: '4px 11px', borderRadius: 6,
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

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack />

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 56px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 18px', letterSpacing: -0.4 }}>
          {t('profile.title')}
        </h1>

        {/* ============ 계정 정보 ============ */}
        <div style={{ ...card$, marginBottom: 14 }}>
          <div style={sectionTitle}>{t('profile.accountSection')}</div>
          {accountRow(t('profile.name'), userName)}
          {accountRow(t('profile.email'), user?.email ?? '—')}
          {joinedAt && accountRow(t('profile.joinedAt'), joinedAt)}
        </div>

        {/* ============ 플랜 ============ */}
        <div style={card$}>
          <div style={sectionTitle}>{t('profile.planSection')}</div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <span style={planBadgeStyle(plan)}>{plan}</span>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                {plan === 'PRO'
                  ? `${t('profile.expiresAt')}: ${expiresLabel}`
                  : t('profile.freeUpsell')}
              </span>
            </div>
            {plan === 'PRO' ? (
              <button style={btnSecondary} onClick={comingSoon}>
                {t('profile.manageSubscription')}
              </button>
            ) : (
              <UpgradeButton />
            )}
          </div>
        </div>
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
