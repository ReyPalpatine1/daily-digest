'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { PlanBadge, getPlanBadge } from '@/components/PlanBadge'
import { AdminHeader } from '@/components/AdminHeader'

type AdminStats = {
  generatedAt: string
  users: {
    total: number; free: number; pro: number; vip: number
    dau: number; mau: number
    newToday: number; newThisWeek: number
    proConversionRate: number
    hasCreatedAt: boolean
  }
  api: {
    gemini: { today: { count: number; input: number; output: number }; limit: number }
    youtube: { today: { count: number }; limit: number }
    supadata: { today: { count: number }; limit: number }
  }
  revenue: {
    subscription: { thisMonth: number; lastMonth: number }
    affiliate: { thisMonth: number; lastMonth: number }
    total: { thisMonth: number; lastMonth: number }
    available: boolean
  }
  system: {
    cronLastRun: string | null
    cronStatus: 'healthy' | 'warning' | 'error'
    sendSuccessRate: number | null
    errors24h: number | null
    dbResponseMs: number
  }
  recentUsers: { email: string; plan: string; joinedAt: string | null }[]
  topChannels: { name: string; category: string | null; subscribers: number }[]
  last7Days: { date: string; gemini: number; youtube: number; supadata: number }[]
}

export default function AdminPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/usage')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (e) {
      console.error('[admin] loadStats failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function checkAdminAndLoad() {
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
      await loadStats()
    }
    checkAdminAndLoad()
    return () => { cancelled = true }
  }, [router, loadStats])

  const nf = new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US')
  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'

  // 로딩 스켈레톤의 상단바 자리 색 (실제 헤더는 AdminHeader가 렌더)
  const ADMIN_BAR_BG = '#0A0A0A'

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 10,
    padding: 16,
  }
  const sectionLabel = (n: number, title: string) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, color: 'var(--text-tertiary)',
        letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600,
      }}>
        {n}. {title}
      </div>
    </div>
  )

  // ===== 로딩 스켈레톤 =====
  if (loading || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ height: 56, background: ADMIN_BAR_BG }} />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ ...cardStyle, height: 160 }}>
                <div style={{ width: '40%', height: 12, background: 'var(--bg-subtle)', borderRadius: 4, marginBottom: 16 }} />
                <div style={{ width: '70%', height: 28, background: 'var(--bg-subtle)', borderRadius: 6, marginBottom: 12 }} />
                <div style={{ width: '90%', height: 12, background: 'var(--bg-subtle)', borderRadius: 4 }} />
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>
            {t('admin.loading')}
          </div>
        </div>
      </div>
    )
  }

  const s = stats!

  // API 진행률 막대
  const apiBar = (label: string, used: number, limit: number) => {
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
    const color = pct >= 80 ? 'var(--danger)' : pct >= 50 ? 'var(--warning)' : 'var(--success)'
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {nf.format(used)} / {nf.format(limit)} · <span style={{ color, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
        </div>
      </div>
    )
  }

  const statCell = (label: string, value: React.ReactNode, accent?: string, badge?: React.ReactNode) => (
    <div style={{
      background: 'var(--bg-subtle)',
      border: '0.5px solid var(--border-light)',
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ marginBottom: 4, minHeight: 16, display: 'flex', alignItems: 'center' }}>
        {badge ?? <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.5, color: accent ?? 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )

  const cronColor =
    s.system.cronStatus === 'healthy' ? 'var(--success)'
      : s.system.cronStatus === 'warning' ? 'var(--warning)'
        : 'var(--danger)'
  const cronText =
    s.system.cronStatus === 'healthy' ? t('admin.cronHealthy')
      : s.system.cronStatus === 'warning' ? t('admin.cronWarning')
        : t('admin.cronError')

  const max7d = Math.max(1, ...s.last7Days.map(d => d.gemini + d.youtube + d.supadata))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="dashboard" />

      {/* ===== 본문 ===== */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        {/* 페이지 헤더 */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
            {t('admin.title')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
            {new Date(s.generatedAt).toLocaleString(dateLocale)} · {t('admin.subtitle')}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {/* 1. 사용자 현황 */}
          <div style={cardStyle}>
            {sectionLabel(1, t('admin.sec1'))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {statCell(t('admin.total'), nf.format(s.users.total))}
              {statCell(t('admin.free'), nf.format(s.users.free), undefined, <PlanBadge plan="FREE" size="sm" />)}
              {statCell(t('admin.proPaid'), nf.format(s.users.pro), undefined, <PlanBadge plan="PRO" size="sm" />)}
              {statCell(t('admin.vip'), nf.format(s.users.vip ?? 0), undefined, <PlanBadge plan="VIP" size="sm" />)}
              {statCell(t('admin.dau'), nf.format(s.users.dau))}
              {statCell(t('admin.mau'), nf.format(s.users.mau))}
              {statCell(
                t('admin.newToday'),
                s.users.hasCreatedAt ? `+${nf.format(s.users.newToday)}` : '—',
                s.users.hasCreatedAt && s.users.newToday > 0 ? 'var(--success)' : undefined,
              )}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
              <span>{t('admin.proConversion')}: <strong style={{ color: 'var(--text-primary)' }}>{s.users.proConversionRate}%</strong></span>
              {s.users.hasCreatedAt && (
                <span>{t('admin.newThisWeek')}: <strong style={{ color: 'var(--text-primary)' }}>+{nf.format(s.users.newThisWeek)}</strong></span>
              )}
            </div>
          </div>

          {/* 2. API 사용량 */}
          <div style={cardStyle}>
            {sectionLabel(2, t('admin.sec2'))}
            {apiBar('Gemini', s.api.gemini.today.count, s.api.gemini.limit)}
            {apiBar('YouTube', s.api.youtube.today.count, s.api.youtube.limit)}
            {apiBar('Supadata', s.api.supadata.today.count, s.api.supadata.limit)}
          </div>

          {/* 3. 수익 통계 */}
          <div style={cardStyle}>
            {sectionLabel(3, t('admin.sec3'))}
            {s.revenue.available ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {statCell(t('admin.revenueSub'), `₩${nf.format(s.revenue.subscription.thisMonth)}`)}
                {statCell(t('admin.revenueAffiliate'), `₩${nf.format(s.revenue.affiliate.thisMonth)}`)}
                {statCell(t('admin.revenueTotal'), `₩${nf.format(s.revenue.total.thisMonth)}`)}
              </div>
            ) : (
              <div style={{
                padding: '24px 12px', textAlign: 'center',
                color: 'var(--text-muted)', fontSize: 13,
                background: 'var(--bg-subtle)', borderRadius: 8,
              }}>
                {t('admin.noData')}
              </div>
            )}
          </div>

          {/* 4. 시스템 상태 */}
          <div style={cardStyle}>
            {sectionLabel(4, t('admin.sec4'))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.cronStatus')}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: cronColor }} />
                  {cronText}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.cronLastRun')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  {s.system.cronLastRun ? new Date(s.system.cronLastRun).toLocaleString(dateLocale) : t('admin.noData')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.sendSuccess')}</span>
                <span style={{ fontSize: 12, color: s.system.sendSuccessRate == null ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                  {s.system.sendSuccessRate == null ? t('admin.noData') : `${s.system.sendSuccessRate}%`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.errors24h')}</span>
                <span style={{ fontSize: 12, color: s.system.errors24h == null ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                  {s.system.errors24h == null ? t('admin.noData') : nf.format(s.system.errors24h)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.dbResponse')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{s.system.dbResponseMs}ms</span>
              </div>
            </div>
          </div>

          {/* 5. 최근 가입 */}
          <div style={cardStyle}>
            {sectionLabel(5, `${t('admin.sec5')} (${s.recentUsers.length})`)}
            {s.recentUsers.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                {t('admin.empty')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {s.recentUsers.slice(0, 6).map((u, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px',
                    borderBottom: i < Math.min(6, s.recentUsers.length) - 1 ? '0.5px solid var(--border-light)' : 'none',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                    <span style={{
                      fontSize: 12, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                    }}>{u.email}</span>
                    <PlanBadge plan={getPlanBadge(u.email, u.plan)} size="sm" />
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                      {u.joinedAt ? new Date(u.joinedAt).toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' }) : '-'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6. 인기 콘텐츠 */}
          <div style={cardStyle}>
            {sectionLabel(6, t('admin.sec6'))}
            {s.topChannels.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                {t('admin.empty')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {s.topChannels.slice(0, 6).map((ch, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px',
                    borderBottom: i < Math.min(6, s.topChannels.length) - 1 ? '0.5px solid var(--border-light)' : 'none',
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
                      width: 18, flexShrink: 0,
                    }}>{i + 1}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                    }}>{ch.name}</span>
                    {ch.category && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        background: 'var(--bg-subtle)', color: 'var(--text-tertiary)', flexShrink: 0,
                      }}>{ch.category}</span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                      {t('admin.subscribers', { n: ch.subscribers })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 7일 사용량 추이 차트 */}
        <div style={{ ...cardStyle, marginTop: 14 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-tertiary)',
            letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600, marginBottom: 14,
          }}>
            {t('admin.weeklyTrend')}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 90, marginBottom: 6 }}>
            {s.last7Days.map(d => {
              const total = d.gemini + d.youtube + d.supadata
              const h = (total / max7d) * 100
              return (
                <div key={d.date}
                  title={`${d.date} · Gemini ${d.gemini} / YouTube ${d.youtube} / Supadata ${d.supadata}`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <div style={{
                    height: `${h}%`, minHeight: total > 0 ? 3 : 0,
                    background: 'linear-gradient(to top, var(--accent), var(--text-tertiary))',
                    borderRadius: 3,
                  }} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-muted)' }}>
            {s.last7Days.map(d => (
              <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>{d.date.slice(5)}</div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
