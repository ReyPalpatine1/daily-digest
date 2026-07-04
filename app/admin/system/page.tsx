'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'

// /admin(대시보드)의 "시스템 상태" 섹션을 분리한 페이지.
// 데이터는 기존 /api/admin/usage 응답의 system/api를 재사용한다.
// 2단계: 외부 API 현황판 + 고정비 안내 + 바로가기 링크 모음 추가.
type ApiEntry = { today: { count: number }; limit: number | null }
type SystemStats = {
  generatedAt: string
  api?: {
    gemini: ApiEntry
    youtube: ApiEntry
    supadata: ApiEntry
    transcriptapi: ApiEntry
  }
  system: {
    cronLastRun: string | null
    cronStatus: 'healthy' | 'warning' | 'error'
    sendSuccessRate: number | null
    errors24h: number | null
    dbResponseMs: number
  }
}

export default function AdminSystemPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/usage')
      if (res.ok) {
        setStats(await res.json())
      }
    } catch (e) {
      console.error('[admin/system] loadStats failed:', e)
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
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--text-primary)', letterSpacing: -0.2,
  }
  const gridStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12,
  }
  // 사용률 색: 100%↑ 위험, 80%↑ 경고, 그 외 기본(흑백 accent). (--error는 없으므로 --danger 사용)
  const usageColor = (pct: number): string =>
    pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--accent)'

  if (loading || !isAdmin || !stats) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ height: 56, background: ADMIN_BAR_BG }} />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          {t('admin.loading')}
        </div>
      </div>
    )
  }

  const s = stats // 위 가드로 여기서는 non-null이 보장됨

  const cronColor =
    s.system.cronStatus === 'healthy' ? 'var(--success)'
      : s.system.cronStatus === 'warning' ? 'var(--warning)'
        : 'var(--danger)'
  const cronText =
    s.system.cronStatus === 'healthy' ? t('admin.cronHealthy')
      : s.system.cronStatus === 'warning' ? t('admin.cronWarning')
        : t('admin.cronError')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="system" />

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
            {t('admin.sec4')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
            {new Date(s.generatedAt).toLocaleString(dateLocale)} · {t('admin.subtitle')}
          </div>
        </div>

        <div style={{ ...cardStyle, maxWidth: 480 }}>
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

        {/* ===== 외부 API 현황 ===== */}
        {s.api && (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionTitleStyle}>{t('adminSystem.apiSectionTitle')}</h2>
            <div style={gridStyle}>
              {([
                { key: 'gemini', label: 'Gemini', desc: t('adminSystem.descGemini'), entry: s.api.gemini, note: null as string | null, noteUrl: null as string | null },
                { key: 'youtube', label: 'YouTube', desc: t('adminSystem.descYoutube'), entry: s.api.youtube, note: null, noteUrl: null },
                { key: 'supadata', label: 'Supadata', desc: t('adminSystem.descSupadata'), entry: s.api.supadata, note: t('adminSystem.supadataCreditNote'), noteUrl: 'https://supadata.ai' },
                { key: 'transcriptapi', label: 'TranscriptAPI', desc: t('adminSystem.descTranscript'), entry: s.api.transcriptapi, note: null, noteUrl: null },
              ]).map(a => {
                const count = a.entry?.today?.count ?? 0
                const limit = a.entry?.limit ?? null
                const pct = limit && limit > 0 ? Math.round((count / limit) * 100) : 0
                const overColor = usageColor(pct)
                const valueColor = pct >= 80 ? overColor : 'var(--text-primary)'
                return (
                  <div key={a.key} style={cardStyle}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{a.desc}</div>

                    {limit != null ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('adminSystem.apiUsageToday')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: valueColor }}>
                            {nf.format(count)} <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>/ {nf.format(limit)}</span>
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-subtle)', overflow: 'hidden', marginTop: 8 }}>
                          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: overColor, borderRadius: 999 }} />
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
                        {t('adminSystem.apiUsageCountOnly', { n: nf.format(count) })}
                      </div>
                    )}

                    {a.note && (
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
                        {a.note}
                        {a.noteUrl && (
                          <>
                            {' '}
                            <a href={a.noteUrl} target="_blank" rel="noopener noreferrer"
                              style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                              {a.label}
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ===== 고정비 안내 ===== */}
        <section style={{ marginTop: 28 }}>
          <h2 style={sectionTitleStyle}>{t('adminSystem.costSectionTitle')}</h2>
          <div style={gridStyle}>
            <div style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Cloudflare Workers</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>{t('adminSystem.costCloudflareValue')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('adminSystem.costCloudflareNote')}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Supabase</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>{t('adminSystem.costSupabaseValue')}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>{t('adminSystem.costFooter')}</div>
        </section>

        {/* ===== 바로가기 링크 ===== */}
        <section style={{ marginTop: 28, marginBottom: 8 }}>
          <h2 style={sectionTitleStyle}>{t('adminSystem.linksSectionTitle')}</h2>
          <div style={gridStyle}>
            {([
              { url: 'https://dash.cloudflare.com', label: t('adminSystem.linkCloudflare'), desc: t('adminSystem.linkCloudflareDesc') },
              { url: 'https://supabase.com/dashboard/project/rqoztfncbgxofxeyguxm', label: t('adminSystem.linkSupabase'), desc: t('adminSystem.linkSupabaseDesc') },
              { url: 'https://console.cloud.google.com', label: t('adminSystem.linkGcp'), desc: t('adminSystem.linkGcpDesc') },
              { url: 'https://aistudio.google.com', label: t('adminSystem.linkGemini'), desc: t('adminSystem.linkGeminiDesc') },
              { url: 'https://supadata.ai', label: t('adminSystem.linkSupadata'), desc: t('adminSystem.linkSupadataDesc') },
              { url: 'https://github.com/ReyPalpatine1/daily-digest', label: t('adminSystem.linkGithub'), desc: t('adminSystem.linkGithubDesc') },
              { url: 'https://dailyvideodigest.com', label: t('adminSystem.linkService'), desc: t('adminSystem.linkServiceDesc') },
            ]).map(l => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                style={{ ...cardStyle, display: 'block', textDecoration: 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{l.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>{l.desc}</div>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
