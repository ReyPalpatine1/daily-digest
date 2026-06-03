'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'

type AdminUser = {
  id: string
  email: string
  name: string | null
  plan: 'free' | 'pro' | 'vip'
  adminNote: string | null
  createdAt: string | null
  lastActiveAt: string | null
  planDays: number
  joinDays: number
  channelCount: number
  totalDigests: number
  avgDigestsPerDay: number
  emailSuccessRate: number | null
  vipGrantedBy: string | null
  vipGrantedAt: string | null
}

type Summary = { total: number; free: number; pro: number; vip: number }
type UsersResponse = { users: AdminUser[]; summary: Summary }

type SortKey = 'email' | 'channels' | 'avg' | 'sendRate' | 'joined'
type SortDir = 'asc' | 'desc'

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
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'joined', dir: 'desc' })

  // 메모 인라인 편집 상태
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null)

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
    overflow: 'hidden',
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

  // ---- 메모 인라인 편집 ----
  function startEditNote(u: AdminUser) {
    setEditingNoteId(u.id)
    setNoteDraft(u.adminNote ?? '')
  }
  function cancelEditNote() {
    setEditingNoteId(null)
    setNoteDraft('')
  }
  async function saveNote(u: AdminUser) {
    const next = noteDraft.trim()
    const prev = (u.adminNote ?? '').trim()
    setEditingNoteId(null)
    if (next === prev) return // 변경 없으면 저장 생략
    setSavingNoteId(u.id)
    // 낙관적 업데이트
    setData(d => d ? {
      ...d,
      users: d.users.map(x => x.id === u.id ? { ...x, adminNote: next || null } : x),
    } : d)
    try {
      const res = await fetch('/api/admin/users/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, note: next }),
      })
      if (!res.ok) {
        alert(t('adminUsers.noteSaveFailed'))
        await loadUsers() // 롤백 위해 재조회
      }
    } catch (e) {
      console.error('[admin/users] saveNote failed:', e)
      alert(t('adminUsers.noteSaveFailed'))
      await loadUsers()
    } finally {
      setSavingNoteId(null)
    }
  }

  // ---- 플랜 뱃지 (관리자 화면에서만 VIP를 보라색으로 구분) ----
  const planBadge = (plan: 'free' | 'pro' | 'vip') => {
    const map = {
      free: { label: 'FREE', bg: 'var(--bg-subtle)', fg: 'var(--text-tertiary)' },
      pro: { label: 'PRO', bg: '#E0EDFF', fg: '#1D4ED8' },           // 결제 → 파랑
      vip: { label: 'VIP', bg: '#EEEDFE', fg: '#3C3489' },           // VIP → 보라
    }[plan]
    return (
      <span style={{
        background: map.bg, color: map.fg,
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap',
      }}>{map.label}</span>
    )
  }

  // ---- 발송률 색상 ----
  function sendRateColor(rate: number | null): string {
    if (rate === null) return 'var(--text-tertiary)'
    if (rate >= 95) return 'var(--success)'
    if (rate >= 90) return 'var(--warning)'
    return 'var(--danger)'
  }

  // ---- 가입일 + 구독기간 (2번째 줄) ----
  function joinDateLabel(iso: string | null): string {
    if (!iso) return '-'
    return new Date(iso).toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' })
  }
  function durationLabel(u: AdminUser): string {
    const joined = `${t('adminUsers.joinedPrefix')} ${joinDateLabel(u.createdAt)}`
    const suffix = t('adminUsers.daysSuffix')
    if (u.plan === 'vip') return `${joined} · VIP ${u.planDays}${suffix}`
    if (u.plan === 'pro') return `${joined} · Pro ${u.planDays}${suffix}`
    return `${joined} · ${u.joinDays}${suffix}`
  }

  const navItems: { key: string; label: string; active: boolean; href?: string }[] = [
    { key: 'dashboard', label: t('admin.menuDashboard'), active: false, href: '/admin' },
    { key: 'users', label: t('admin.menuUsers'), active: true },
    { key: 'content', label: t('admin.menuContent'), active: false },
    { key: 'system', label: t('admin.menuSystem'), active: false },
    { key: 'email', label: '📧 Email', active: false, href: '/admin/email-preview' },
  ]

  // ---- 필터 + 검색 + 정렬 적용 ----
  const visible = useMemo(() => {
    const users = data?.users ?? []
    const q = search.trim().toLowerCase()
    const filtered = users.filter(u => {
      if (filter !== 'all' && u.plan !== filter) return false
      if (q) {
        const inEmail = u.email.toLowerCase().includes(q)
        const inNote = (u.adminNote ?? '').toLowerCase().includes(q)
        if (!inEmail && !inNote) return false
      }
      return true
    })

    const dir = sort.dir === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'email':
          return a.email.localeCompare(b.email, locale === 'ko' ? 'ko' : 'en') * dir
        case 'channels':
          return (a.channelCount - b.channelCount) * dir
        case 'avg':
          return (a.avgDigestsPerDay - b.avgDigestsPerDay) * dir
        case 'sendRate': {
          // null은 항상 뒤로
          const av = a.emailSuccessRate
          const bv = b.emailSuccessRate
          if (av === null && bv === null) return 0
          if (av === null) return 1
          if (bv === null) return -1
          return (av - bv) * dir
        }
        case 'joined': {
          const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return (at - bt) * dir
        }
        default:
          return 0
      }
    })
    return sorted
  }, [data, search, filter, sort, locale])

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'email' ? 'asc' : 'desc' })
  }
  const sortArrow = (key: SortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''

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

  const summary = data?.summary
  const summaryLine = summary
    ? `${t('adminUsers.summaryTotal')} ${summary.total} · Free ${summary.free} · Pro ${summary.pro} · VIP ${summary.vip}`
    : ''

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

  // 정렬 가능한 헤더 셀
  const thBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
    padding: '10px 12px', whiteSpace: 'nowrap', userSelect: 'none',
    borderBottom: '0.5px solid var(--border)', background: 'var(--bg-subtle)',
  }
  const sortableTh = (key: SortKey, label: string, align: 'left' | 'right' | 'center') => (
    <th
      onClick={() => toggleSort(key)}
      style={{
        ...thBase, textAlign: align, cursor: 'pointer',
        color: sort.key === key ? 'var(--text-primary)' : 'var(--text-tertiary)',
      }}>
      {label}{sortArrow(key)}
    </th>
  )
  const plainTh = (label: string, align: 'left' | 'right' | 'center') => (
    <th style={{ ...thBase, textAlign: align }}>{label}</th>
  )
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', borderBottom: '0.5px solid var(--border-light)',
    verticalAlign: 'middle',
  }

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
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap', marginBottom: 20,
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
            {t('adminUsers.title')}
          </h1>
          {summary && (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              {summaryLine}
            </div>
          )}
        </div>

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

        {/* 사용자 테이블 (모바일 가로 스크롤) */}
        <div style={{ ...cardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {sortableTh('email', t('adminUsers.colUser'), 'left')}
                {plainTh(t('adminUsers.colNote'), 'left')}
                {plainTh(t('adminUsers.colPlan'), 'center')}
                {sortableTh('channels', t('adminUsers.colChannels'), 'right')}
                {sortableTh('avg', t('adminUsers.colAvg'), 'right')}
                {sortableTh('sendRate', t('adminUsers.colSendRate'), 'right')}
                {plainTh(t('adminUsers.colAction'), 'right')}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {t('adminUsers.empty')}
                  </td>
                </tr>
              ) : visible.map(u => (
                <tr key={u.id}>
                  {/* 1. 사용자 (이메일 + 가입/구독기간) */}
                  <td style={{ ...tdStyle, minWidth: 180, maxWidth: 240 }}>
                    <div style={{
                      fontSize: 13, color: 'var(--text-primary)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{u.email}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {durationLabel(u)}
                    </div>
                  </td>

                  {/* 2. 메모 (인라인 편집) */}
                  <td style={{ ...tdStyle, minWidth: 130, maxWidth: 200 }}>
                    {editingNoteId === u.id ? (
                      <input
                        autoFocus
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        onBlur={() => saveNote(u)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveNote(u) }
                          else if (e.key === 'Escape') { e.preventDefault(); cancelEditNote() }
                        }}
                        placeholder={t('adminUsers.noteInputPlaceholder')}
                        style={{
                          width: '100%', fontSize: 12,
                          background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
                          borderRadius: 6, padding: '5px 8px', color: 'var(--text-primary)',
                          fontFamily: 'inherit', outline: 'none',
                        }} />
                    ) : (
                      <div
                        onClick={() => startEditNote(u)}
                        title={u.adminNote ?? ''}
                        style={{
                          fontSize: 12, cursor: 'text', padding: '5px 0',
                          color: u.adminNote ? 'var(--text-secondary)' : 'var(--text-muted)',
                          fontStyle: u.adminNote ? 'normal' : 'italic',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          opacity: savingNoteId === u.id ? 0.5 : 1,
                        }}>
                        {u.adminNote || t('adminUsers.notePlaceholder')}
                      </div>
                    )}
                  </td>

                  {/* 3. 플랜 뱃지 */}
                  <td style={{ ...tdStyle, textAlign: 'center', width: 70 }}>
                    {planBadge(u.plan)}
                  </td>

                  {/* 4. 채널 수 */}
                  <td style={{ ...tdStyle, textAlign: 'right', width: 70, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {u.channelCount}
                  </td>

                  {/* 5. 평균 요약 */}
                  <td style={{ ...tdStyle, textAlign: 'right', width: 90, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {u.avgDigestsPerDay.toFixed(1)}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t('adminUsers.perDay')}</span>
                  </td>

                  {/* 6. 발송률 */}
                  <td style={{ ...tdStyle, textAlign: 'right', width: 80, fontSize: 13, fontWeight: 500, color: sendRateColor(u.emailSuccessRate) }}>
                    {u.emailSuccessRate === null ? t('adminUsers.noData') : `${u.emailSuccessRate}%`}
                  </td>

                  {/* 7. 액션 */}
                  <td style={{ ...tdStyle, textAlign: 'right', width: 110 }}>
                    {u.plan === 'pro' ? (
                      <span title={t('adminUsers.paidProWarn')}
                        style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t('adminUsers.paidProLocked')}
                      </span>
                    ) : u.plan === 'vip' ? (
                      <button onClick={() => setPlan(u, 'free')} disabled={busyId === u.id}
                        style={{
                          padding: '5px 10px', borderRadius: 6,
                          border: '0.5px solid var(--border)', background: 'var(--bg-card)',
                          color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500,
                          cursor: busyId === u.id ? 'wait' : 'pointer', fontFamily: 'inherit',
                          opacity: busyId === u.id ? 0.6 : 1, whiteSpace: 'nowrap',
                        }}>
                        {t('adminUsers.revokeVip')}
                      </button>
                    ) : (
                      <button onClick={() => setPlan(u, 'vip')} disabled={busyId === u.id}
                        style={{
                          padding: '5px 10px', borderRadius: 6, border: 'none',
                          background: 'var(--accent)', color: 'var(--bg-card)',
                          fontSize: 11, fontWeight: 600,
                          cursor: busyId === u.id ? 'wait' : 'pointer', fontFamily: 'inherit',
                          opacity: busyId === u.id ? 0.6 : 1, whiteSpace: 'nowrap',
                        }}>
                        {t('adminUsers.grantVip')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
