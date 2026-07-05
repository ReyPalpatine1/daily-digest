'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import UserPlanBadge from '@/components/UserPlanBadge'
import { LanguageSubmenu } from '@/components/LanguageSubmenu'

// 공통 상단바 — 대시보드 헤더와 동일한 모양/동작을 하위 페이지(profile/pricing)에서 재사용.
// 대시보드 전용 네비(채널/발송설정/열람기록)는 포함하지 않는다 (A안: 하위 페이지엔 네비 없음).
// 플랜/언어/테마 상태는 컴포넌트 내부에서 자체 로드.
export function AppHeader({
  showBack = false,
  onHelpClick,
  showTabs = false,
  tabs = [],
  activeTab,
  onTabChange,
  breakingUnread = 0,
  onOpenSidebar,
  adminPlanMode: adminPlanModeProp,
  onAdminPlanModeChange,
}: {
  showBack?: boolean
  onHelpClick?: () => void
  // 아래는 대시보드 전용(showTabs) 옵션. 미전달 시 프로필/요금제 기존 동작과 100% 동일.
  showTabs?: boolean
  tabs?: { key: string; label: string }[]
  activeTab?: string
  onTabChange?: (key: string) => void
  breakingUnread?: number
  onOpenSidebar?: () => void
  adminPlanMode?: 'free' | 'pro'
  onAdminPlanModeChange?: (mode: 'free' | 'pro') => void
}) {
  const router = useRouter()
  const { t, locale, changeLocale } = useTranslation()

  // undefined = 로딩 중, null = 비로그인 확정, 객체 = 로그인. (약관 문서 등 비로그인 접근 대비)
  const [user, setUser] = useState<any>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminPlanMode, setAdminPlanMode] = useState<'free' | 'pro'>('free')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 언어 하위 메뉴: 데스크탑은 옆 플라이아웃, 모바일은 인라인 아코디언으로 분기
  const [isMobile, setIsMobile] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  // 플랜 판정 (대시보드와 동일: 관리자는 미리보기 토글 우선, 일반 사용자는 실제 plan 기반)
  // showTabs(대시보드) 모드에선 주입된 adminPlanMode를 우선 사용, 아니면 자체 상태(localStorage 기반).
  const realIsPro = checkIsPro(profile, isAdmin)
  const effectiveAdminPlanMode = showTabs && adminPlanModeProp ? adminPlanModeProp : adminPlanMode
  const isPro = isAdmin ? effectiveAdminPlanMode === 'pro' : realIsPro
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // 로그인 상태 분기. isLoggedIn=계정/플랜 UI 노출, isLoggedOut(=null)=로그인 버튼 노출.
  // 로딩 중(undefined)엔 둘 다 false → 계정 영역을 비워둔다(PRO 깜빡임·오표시 방지).
  const isLoggedIn = !!user
  const isLoggedOut = user === null

  // 사용자 / 프로필 / 관리자 모드 자체 로드
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      if (!data.user) { setUser(null); return } // 비로그인 확정 (undefined=로딩과 구분)
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

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
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
  // 대시보드 탭 네비/업그레이드/속보 뱃지 (대시보드 헤더와 동일 모양) — showTabs 모드에서만 사용
  const navBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 7,
    background: active ? 'var(--bg-subtle)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    fontWeight: active ? 500 : 400,
    border: 'none',
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s, color 0.15s',
    fontFamily: 'inherit',
  })
  const proUpgradeBtn: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 7,
    background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
    color: '#FFFFFF',
    fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }
  const breakingBadge: React.CSSProperties = {
    background: 'var(--danger)', color: '#fff',
    fontSize: 10, fontWeight: 600,
    padding: '1px 6px', borderRadius: 999,
    lineHeight: 1.4,
  }

  // 설정 메뉴 항목 (대시보드 renderSettingsItems 와 동일 항목 재현)
  function renderSettingsItems(closeMenu: () => void) {
    const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
    return (
      <>
        {/* 사용자 헤더 (로그인 시에만) */}
        {isLoggedIn && (
          <>
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
              <UserPlanBadge plan={plan} size="sm" />
            </button>
            <div style={dropdownDivider} />
          </>
        )}

        {/* 언어 (하위 메뉴: 데스크탑=플라이아웃 / 모바일=아코디언) — 로그인 무관 */}
        <LanguageSubmenu
          locale={locale}
          label={t('settings.language')}
          itemStyle={dropdownItemStyle}
          isMobile={isMobile}
          onSelect={(l) => { closeMenu(); changeLocale(l) }}
        />

        {/* 도움말은 로그인(온보딩) 전용 → 비로그인 숨김 */}
        {isLoggedIn && (
          <button style={dropdownItemStyle} onClick={() => { closeMenu(); if (onHelpClick) onHelpClick(); else router.push('/dashboard') }}>
            {t('settings.help')}
          </button>
        )}
        {/* 약관/개인정보/환불은 문서라 비로그인도 접근 가능 → 항상 노출 */}
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/terms') }}>
          {t('settings.terms')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/privacy') }}>
          {t('settings.privacy')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/refund') }}>
          {t('settings.refund')}
        </button>

        {isAdmin && (
          <>
            <div style={dropdownDivider} />
            <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/admin') }}>
              {t('admin.adminMode')}
            </button>
          </>
        )}

        {isLoggedIn && plan === 'FREE' && (
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
                {t('nav.proUpgrade')}
              </button>
            </div>
          </>
        )}

        {/* 로그인 시 로그아웃 / 비로그인 확정 시 로그인. 로딩 중(undefined)엔 둘 다 숨김. */}
        {isLoggedIn && (
          <>
            <div style={dropdownDivider} />
            <button style={dropdownItemStyle} onClick={() => { closeMenu(); logout() }}>
              {t('settings.logout')}
            </button>
          </>
        )}
        {isLoggedOut && (
          <>
            <div style={dropdownDivider} />
            <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/') }}>
              {t('landing.loginShort')}
            </button>
          </>
        )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: showTabs && !isMobile ? 18 : 12 }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, fontFamily: 'inherit', color: 'var(--text-primary)',
            }}>
            <div style={logoBox}>D</div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Daily Video Digest</div>
          </button>
          {isLoggedIn && <UserPlanBadge plan={plan} size="sm" />}
          {/* 뒤로가기 (로고 그룹 오른쪽 끝) */}
          {showBack && (
            <button
              onClick={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/') }}
              aria-label={t('subscribe.back')}
              title={t('subscribe.back')}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              style={{ ...toolbarIconBtn, fontSize: 18 }}>
              ←
            </button>
          )}
          {/* 대시보드 탭 네비 (데스크톱만; 모바일은 사이드바에 있음) */}
          {showTabs && !isMobile && tabs.length > 0 && (
            <nav style={{ display: 'flex', gap: 2 }}>
              {tabs.map(tab => (
                <button key={tab.key} onClick={() => onTabChange?.(tab.key)}
                  style={navBtnStyle(activeTab === tab.key)}
                  onMouseEnter={e => { if (activeTab !== tab.key) e.currentTarget.style.background = 'var(--bg-subtle)' }}
                  onMouseLeave={e => { if (activeTab !== tab.key) e.currentTarget.style.background = 'transparent' }}>
                  {tab.label}
                  {tab.key === 'history' && breakingUnread > 0 && (
                    <span style={breakingBadge}>{breakingUnread}</span>
                  )}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 대시보드 전용: Free면 Pro 업그레이드 버튼 (데스크톱) */}
          {showTabs && !isMobile && isLoggedIn && plan === 'FREE' && (
            <button onClick={() => router.push('/pricing')} style={proUpgradeBtn}>
              {t('nav.proUpgrade')}
            </button>
          )}
          {/* 대시보드 전용: 관리자 Free/Pro 미리보기 토글 (데스크톱). 상태는 주입값, 클릭은 콜백 우선 */}
          {showTabs && !isMobile && isLoggedIn && isAdmin && (
            <div title={t('plans.previewHint')}
              style={{
                display: 'inline-flex',
                background: 'var(--bg-subtle)',
                borderRadius: 7,
                padding: 2,
                border: '0.5px dashed var(--border)',
              }}>
              {(['free', 'pro'] as const).map(mode => {
                const active = effectiveAdminPlanMode === mode
                const label = mode === 'pro' ? 'Pro' : 'Free'
                return (
                  <button key={mode}
                    onClick={() => {
                      if (onAdminPlanModeChange) onAdminPlanModeChange(mode)
                      else { setAdminPlanMode(mode); try { localStorage.setItem('admin_plan_mode', mode) } catch {} }
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-tertiary)' }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 5,
                      background: active ? 'var(--bg-card)' : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      fontWeight: active ? 500 : 400,
                      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                      border: 'none',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'background 0.15s, color 0.15s',
                    }}>
                    <span style={{ fontSize: 10, opacity: active ? 1 : 0.6 }}>👁</span>
                    {label}
                  </button>
                )
              })}
            </div>
          )}
          {/* 빠른 테마 토글 (언어 토글은 설정 드롭다운 안으로 이동) */}
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
            title={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            style={{ ...toolbarIconBtn, fontSize: 14 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {/* 모바일 대시보드: 햄버거(사이드바). 그 외: 설정 기어(드롭다운) */}
          {showTabs && isMobile ? (
            <button
              onClick={() => { if (onOpenSidebar) onOpenSidebar() }}
              aria-label={t('nav.openMenu')}
              style={{ ...toolbarIconBtn, fontSize: 20, color: 'var(--text-primary)' }}>
              ☰
            </button>
          ) : (
            <button ref={settingsBtnRef} onClick={() => setSettingsOpen(o => !o)}
              aria-label={t('common.settings')}
              style={gearBtn}>
              ⚙
            </button>
          )}
        </div>
      </header>

      {/* 설정 드롭다운 (모바일 대시보드는 사이드바가 대신하므로 미표시) */}
      {settingsOpen && !(showTabs && isMobile) && (
        <div ref={settingsMenuRef} style={dropdownStyle}>
          {renderSettingsItems(() => setSettingsOpen(false))}
        </div>
      )}
    </>
  )
}

export default AppHeader
