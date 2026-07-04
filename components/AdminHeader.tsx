'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'

// 관리자 페이지 공통 상단바 — 개요 탭 헤더를 기준으로 통일.
// 검정 바(#0A0A0A) + ADMIN 빨강 뱃지 + 로고 + 네비 + 모드 토글.
// ⚠️ 사용자용 components/AppHeader.tsx, 관리자 플랜뱃지 components/PlanBadge.tsx와는 별개.

// 관리자 상단바는 테마와 무관하게 항상 검정 고정
const ADMIN_BAR_BG = '#0A0A0A'
const ADMIN_BAR_FG = '#FAFAFA'
const ADMIN_BAR_MUTED = '#71717A'
const ADMIN_BAR_SUBTLE = '#1F1F1F'

export type AdminNavKey = 'dashboard' | 'users' | 'errors' | 'content' | 'system' | 'email'

export function AdminHeader({ activeKey }: { activeKey: AdminNavKey }) {
  const router = useRouter()
  const { t } = useTranslation()

  const navItems: { key: AdminNavKey; label: string; href?: string }[] = [
    { key: 'dashboard', label: t('admin.menuDashboard'), href: '/admin' },
    { key: 'users', label: t('admin.menuUsers'), href: '/admin/users' },
    { key: 'errors', label: t('admin.menuErrors'), href: '/admin/errors' },
    { key: 'content', label: t('admin.menuContent'), href: '/admin/content' },
    { key: 'system', label: t('admin.menuSystem'), href: '/admin/system' },
    { key: 'email', label: '📧 Email', href: '/admin/email-preview' },
  ]

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      height: 56, background: ADMIN_BAR_BG,
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '0 20px',
      borderBottom: `0.5px solid ${ADMIN_BAR_SUBTLE}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div
          onClick={() => router.push('/dashboard')}
          role="button"
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
          <div style={{
            width: 24, height: 24, borderRadius: 7,
            background: '#FAFAFA', color: '#0A0A0A',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>D</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: ADMIN_BAR_FG, letterSpacing: -0.2 }}>
            Daily Digest
          </span>
        </div>
        <span style={{
          background: 'var(--danger)', color: '#fff',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
          padding: '2px 7px', borderRadius: 4,
        }}>ADMIN</span>
      </div>

      {/* 메뉴 */}
      <nav style={{ display: 'flex', gap: 2 }}>
        {navItems.map(item => {
          const active = item.key === activeKey
          return (
            <button key={item.key}
              onClick={() => { if (item.href) router.push(item.href) }}
              style={{
                padding: '6px 12px', borderRadius: 7, border: 'none',
                background: active ? ADMIN_BAR_SUBTLE : 'transparent',
                color: active ? ADMIN_BAR_FG : ADMIN_BAR_MUTED,
                fontWeight: active ? 500 : 400,
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* 모드 토글 */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'inline-flex', background: ADMIN_BAR_SUBTLE, borderRadius: 7, padding: 2 }}>
          <button onClick={() => router.push('/dashboard')}
            style={{
              padding: '4px 10px', borderRadius: 5, border: 'none',
              background: 'transparent', color: ADMIN_BAR_MUTED,
              fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {t('admin.userMode')}
          </button>
          <button
            style={{
              padding: '4px 10px', borderRadius: 5, border: 'none',
              background: '#FAFAFA', color: '#0A0A0A',
              fontSize: 11, fontWeight: 500, cursor: 'default', fontFamily: 'inherit',
            }}>
            {t('admin.adminMode')}
          </button>
        </div>
      </div>
    </header>
  )
}
