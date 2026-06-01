'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'

type AdminUser = {
  id: string
  email: string
  name: string | null
  plan: 'free' | 'pro' | 'vip'
  planExpiresAt: string | null
  vipGrantedBy: string | null
  vipGrantedAt: string | null
  joinedAt: string | null
}

type UsersResponse = {
  users: AdminUser[]
  counts: { total: number; free: number; pro: number; vip: number }
}

export default function AdminUsersPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState<UsersResponse | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'free' | 'pro' | 'vip'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const nf = new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US')
  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'

  // ---- 관리자 상단바 고정 색상 (admin/page.tsx와 동일) ----
  const ADMIN_BAR_BG = '#0A0A0A'
  const ADMIN_BAR_FG = '#FAFAFA'
  const ADMIN_BAR_MUTED = '#71717A'
  const ADMIN_BAR_SUBTLE = '#1F1F1F'

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 10,
    padding: 16,
  }

  const loadUsers = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/users')
      if (res.ok) {
        setData(await res.json())
      }
    } catch (e) {
      console.error('[admin/users] load failed:', e)
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function checkAndLoad() {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) { router.push('/'); return }
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      if (!adminEmails.includes((user.email ?? '').toLowerCase())) {
        router.push('/dashboard')
        return
      }
      setIsAdmin(true)
      await loadUsers()
    }
    checkAndLoad()
    return () => { cancelled = true }
  }, [router, loadUsers])

  async function setPlan(target: AdminUser, plan: 'vip' | 'free') {
    const confirmKey = plan === 'vip' ? 'adminUsers.confirmGrant' : 'adminUsers.confirmRevoke'
    if (!confirm(t(confirmKey, { email: target.email }))) return
    setBusyId(target.id)
    try {
      const res = await fetch('/api/admin/set-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: target.id, plan }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? t('adminUsers.actionFailed'))
        return
      }
      await loadUsers()
    } catch (e) {
      console.error('[admin/users] setPlan failed:', e)
      alert(t('adminUsers.actionFailed'))
    } finally {
      setBusyId(null)
    }
  }

  // 플랜 뱃지 (관리자 화면에서는 VIP/Pro 구분해서 표시)
  const planBadge = (plan: 'free' | 'pro' | 'vip') => {
    const map = {
      free: { label: 'FREE', bg: 'var(--bg-subtle)', fg: 'var(--text-tertiary)' },
      pro: { label: 'PRO', bg: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)', fg: '#FFFFFF' },
      vip: { label: 'VIP', bg: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)', fg: '#FFFFFF' },
    }[plan]
    return (
      <span style={{
        background: map.bg, color: map.fg,
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        padding: '2px 7px', borderRadius: 4, flexShrink: 0,
      }}>{map.label}</span>
    )
  }

  const navItems: { key: string; label: string; active: boolean; href?: string }[] = [
    { key: 'dashboard', label: t('admin.menuDashboard'), active: false, href: '/admin' },
    { key: 'users', label: t('admin.menuUsers'), active: true },
    { key: 'content', label: t('admin.menuContent'), active: false },
    { key: 'system', label: t('admin.menuSystem'), active: false },
    { key: 'email', label: '📧 Email', active: false, href: '/admin/email-preview' },
  ]

  if (loading || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ height: 56, background: ADMIN_BAR_BG }} />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          {t('adminUsers.loading')}
        </div>
      </div>
    )
  }

  const d = data
  const users = d?.users ?? []
  const visible = users.filter(u => {
    if (filter !== 'all' && u.plan !== filter) return false
    if (search.trim() && !u.email.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  })

  const filterChip = (key: 'all' | 'free' | 'pro' | 'vip', label: string) => {
    const active = filter === key
    return (
      <button key={key} onClick={() => setFilter(key)}
        style={{
          padding: '5px 12px', borderRadius: 7, border: 'none',
          background: active ? 'var(--accent)' : 'var(--bg-subtle)',
          color: active ? 'var(--bg-card)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
        {label}
      </button>
    )
  }

  const summaryCell = (label: string, value: number, accent?: string) => (
    <div style={{
      background: 'var(--bg-subtle)', border: '0.5px solid var(--border-light)',
      borderRadius: 8, padding: '10px 12px', flex: 1, minWidth: 90,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.5, color: accent ?? 'var(--text-primary)' }}>
        {nf.format(value)}
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      {/* ===== 관리자 상단바 ===== */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        height: 56, background: ADMIN_BAR_BG,
        display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px',
        borderBottom: `0.5px solid ${ADMIN_BAR_SUBTLE}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 7,
            background: '#FAFAFA', color: '#0A0A0A',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>D</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: ADMIN_BAR_FG, letterSpacing: -0.2 }}>
            Daily Digest
          </span>
          <span style={{
            background: 'var(--danger)', color: '#fff',
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 7px', borderRadius: 4,
          }}>ADMIN</span>
        </div>

        <nav style={{ display: 'flex', gap: 2 }}>
          {navItems.map(item => (
            <button key={item.key}
              onClick={() => { if (item.href) router.push(item.href) }}
              style={{
                padding: '6px 12px', borderRadius: 7, border: 'none',
                background: item.active ? ADMIN_BAR_SUBTLE : 'transparent',
                color: item.active ? ADMIN_BAR_FG : ADMIN_BAR_MUTED,
                fontWeight: item.active ? 500 : 400,
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={loadUsers} disabled={refreshing}
            style={{
              padding: '5px 10px', borderRadius: 6,
              background: ADMIN_BAR_SUBTLE, border: 'none',
              color: ADMIN_BAR_FG, fontSize: 11, fontWeight: 500,
              cursor: refreshing ? 'wait' : 'pointer', fontFamily: 'inherit',
              opacity: refreshing ? 0.6 : 1,
            }}>
            🔄 {t('admin.refresh')}
          </button>
          <button onClick={() => router.push('/dashboard')}
            style={{
              padding: '5px 10px', borderRadius: 6,
              background: 'transparent', border: 'none',
              color: ADMIN_BAR_MUTED, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {t('admin.userMode')}
          </button>
        </div>
      </header>

      {/* ===== 본문 ===== */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
            {t('adminUsers.title')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
            {t('adminUsers.subtitle')}
          </div>
        </div>

        {/* 요약 통계 */}
        {d && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {summaryCell(t('adminUsers.summaryTotal'), d.counts.total)}
            {summaryCell(t('adminUsers.summaryFree'), d.counts.free)}
            {summaryCell(t('adminUsers.summaryPro'), d.counts.pro, 'var(--success)')}
            {summaryCell(t('adminUsers.summaryVip'), d.counts.vip, '#8B5CF6')}
          </div>
        )}

        {/* 검색 + 필터 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('adminUsers.searchPlaceholder')}
            style={{
              flex: 1, minWidth: 200,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }} />
          <div style={{ display: 'flex', gap: 6 }}>
            {filterChip('all', t('adminUsers.filterAll'))}
            {filterChip('free', t('adminUsers.filterFree'))}
            {filterChip('pro', t('adminUsers.filterPro'))}
            {filterChip('vip', t('adminUsers.filterVip'))}
          </div>
        </div>

        {/* 사용자 목록 */}
        <div style={cardStyle}>
          {visible.length === 0 ? (
            <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('adminUsers.empty')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visible.map((u, i) => (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 8px',
                  borderBottom: i < visible.length - 1 ? '0.5px solid var(--border-light)' : 'none',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, color: 'var(--text-primary)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{u.email}</div>
                    {u.plan === 'vip' && u.vipGrantedBy && (
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {t('adminUsers.grantedBy', { who: u.vipGrantedBy })}
                        {u.vipGrantedAt ? ` · ${new Date(u.vipGrantedAt).toLocaleDateString(dateLocale)}` : ''}
                      </div>
                    )}
                  </div>
                  {planBadge(u.plan)}
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, width: 64, textAlign: 'right' }}>
                    {u.joinedAt ? new Date(u.joinedAt).toLocaleDateString(dateLocale, { year: '2-digit', month: 'numeric', day: 'numeric' }) : '-'}
                  </span>
                  <div style={{ flexShrink: 0, width: 96, textAlign: 'right' }}>
                    {u.plan === 'pro' ? (
                      <span title={t('adminUsers.paidProWarn')}
                        style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t('adminUsers.paidProLocked')}
                      </span>
                    ) : u.plan === 'vip' ? (
                      <button onClick={() => setPlan(u, 'free')} disabled={busyId === u.id}
                        style={{
                          padding: '5px 10px', borderRadius: 6,
                          border: '0.5px solid var(--danger)', background: 'var(--bg-card)',
                          color: 'var(--danger)', fontSize: 11, fontWeight: 500,
                          cursor: busyId === u.id ? 'wait' : 'pointer', fontFamily: 'inherit',
                          opacity: busyId === u.id ? 0.6 : 1,
                        }}>
                        {t('adminUsers.revokeVip')}
                      </button>
                    ) : (
                      <button onClick={() => setPlan(u, 'vip')} disabled={busyId === u.id}
                        style={{
                          padding: '5px 10px', borderRadius: 6, border: 'none',
                          background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
                          color: '#fff', fontSize: 11, fontWeight: 600,
                          cursor: busyId === u.id ? 'wait' : 'pointer', fontFamily: 'inherit',
                          opacity: busyId === u.id ? 0.6 : 1,
                        }}>
                        {t('adminUsers.grantVip')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
