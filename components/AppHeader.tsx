'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'

// 공통 상단바 — 대시보드 헤더와 동일한 모양/동작을 하위 페이지(profile/pricing)에서 재사용.
// 대시보드 전용 네비(채널/발송설정/열람기록)는 포함하지 않는다 (A안: 하위 페이지엔 네비 없음).
// 플랜/언어/테마 상태는 컴포넌트 내부에서 자체 로드.
export function AppHeader({ showBack = false }: { showBack?: boolean }) {
  const router = useRouter()
  const { t, locale, changeLocale } = useTranslation()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminPlanMode, setAdminPlanMode] = useState<'free' | 'pro'>('free')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  // 플랜 판정 (대시보드와 동일: 관리자는 미리보기 토글 우선, 일반 사용자는 실제 plan 기반)
  const realIsPro = checkIsPro(profile, isAdmin)
  const isPro = isAdmin ? adminPlanMode === 'pro' : realIsPro
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // 사용자 / 프로필 / 관리자 모드 자체 로드
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled || !data.user) return
      setUser(data.user)

      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      const isAdminUser = adminEmails.includes(data.user.email?.toLowerCase() ?? '')
      setIsAdmin(isAdminUser)
      if (isAdminUser) {
        try { if (localStorage.getItem('admin_plan_mode') === 'pro') setAdminPlanMode('pro') } catch {}
      }

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      if (cancelled) return
      setProfile(profileRow as Profile | null)
    })
    return () => { cancelled = true }
  }, [])

  // 테마 초기 동기화 (layout.tsx bootstrap script 가 이미 html.dataset.theme 설정)
  useEffect(() => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    setTheme(current)
  }, [])

  // 설정 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!settingsOpen) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (settingsMenuRef.current?.contains(target)) return
      if (settingsBtnRef.current?.contains(target)) return
      setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [settingsOpen])

  function toggleTheme() {
    const next: 'light' | 'dark' = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch {}
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  // === 공통 스타일 토큰 (대시보드와 동일) ===
  const logoBox: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 7,
    background: 'var(--accent)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--bg-card)', fontSize: 12, fontWeight: 700,
    flexShrink: 0,
  }
  const gearBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8,
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
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
  const dropdownStyle: React.CSSProperties = {
    position: 'fixed',
    top: 60,
    right: 16,
    width: 280,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    padding: 6,
    zIndex: 60,
  }
  const dropdownItemStyle: React.CSSProperties = {
    width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: 7,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 10,
    fontFamily: 'inherit',
  }
  const dropdownDivider: React.CSSProperties = {
    height: 1, background: 'var(--border-light)', margin: '6px 4px',
  }
  const toolbarIconBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 6,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
  }

  // 설정 메뉴 항목 (대시보드 renderSettingsItems 와 동일 항목 재현)
  function renderSettingsItems(closeMenu: () => void) {
    const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
    return (
      <>
        {/* 사용자 헤더 */}
        <button
          style={{ ...dropdownItemStyle, padding: '10px 12px' }}
          onClick={() => { closeMenu(); router.push('/profile') }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </span>
          </div>
          <span style={planBadgeStyle(plan)}>{plan}</span>
        </button>

        <div style={dropdownDivider} />

        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/profile?tab=help') }}>
          <span style={{ fontSize: 14 }}>❓</span> {t('settings.help')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/terms') }}>
          <span style={{ fontSize: 14 }}>📄</span> {t('settings.terms')}
        </button>

        {isAdmin && (
          <>
            <div style={dropdownDivider} />
            <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/admin') }}>
              <span style={{ fontSize: 14 }}>🔐</span> {t('admin.adminMode')}
            </button>
          </>
        )}

        {plan === 'FREE' && (
          <>
            <div style={dropdownDivider} />
            <div style={{ padding: '4px 6px 6px' }}>
              <button onClick={() => { closeMenu(); router.push('/pricing') }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                ✨ {t('nav.proUpgrade')}
              </button>
            </div>
          </>
        )}

        <div style={dropdownDivider} />

        <button style={dropdownItemStyle} onClick={() => { closeMenu(); logout() }}>
          <span style={{ fontSize: 14 }}>🚪</span> {t('settings.logout')}
        </button>
      </>
    )
  }

  return (
    <>
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 56,
        background: 'var(--bg-card)',
        borderBottom: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 뒤로가기 (로고 바로 왼쪽) */}
          {showBack && (
            <button
              onClick={() => router.back()}
              aria-label={t('subscribe.back')}
              title={t('subscribe.back')}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              style={{ ...toolbarIconBtn, fontSize: 18 }}>
              ←
            </button>
          )}
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, fontFamily: 'inherit', color: 'var(--text-primary)',
            }}>
            <div style={logoBox}>D</div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Daily Digest</div>
          </button>
          <span style={planBadgeStyle(plan)}>{plan}</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 빠른 언어 토글 */}
          <button
            onClick={() => changeLocale(locale === 'ko' ? 'en' : 'ko')}
            aria-label={t('settings.language')}
            title={t('settings.language')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            style={{ ...toolbarIconBtn, fontSize: 11, fontWeight: 600 }}>
            {locale === 'ko' ? 'KO' : 'EN'}
          </button>
          {/* 빠른 테마 토글 */}
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
            title={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            style={{ ...toolbarIconBtn, fontSize: 14 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button ref={settingsBtnRef} onClick={() => setSettingsOpen(o => !o)}
            aria-label={t('common.settings')}
            style={gearBtn}>
            ⚙
          </button>
        </div>
      </header>

      {/* 설정 드롭다운 */}
      {settingsOpen && (
        <div ref={settingsMenuRef} style={dropdownStyle}>
          {renderSettingsItems(() => setSettingsOpen(false))}
        </div>
      )}
    </>
  )
}

export default AppHeader
