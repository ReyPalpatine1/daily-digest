'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'

// /admin(대시보드)의 "시스템 상태" 섹션을 분리한 페이지.
// 데이터는 기존 /api/admin/usage 응답의 system/api를 재사용한다.
// 2단계: 외부 API 현황판 + 고정비 안내 + 바로가기 링크 모음 추가.
// 시스템 상태(cron·발송 성공률·에러·DB 응답) 블록은 대시보드(/admin)로 복귀했다.
// 이 페이지는 외부 API 현황 + 고정비 안내 + 바로가기 링크 전용.
type ApiEntry = {
  today: { count: number }
  monthTotal?: number
  avg30d?: number // 최근 30일 하루평균 (gemini/youtube만)
  limit: number | null
  limitPeriod?: 'day' | 'month' | null
}
type SystemStats = {
  generatedAt: string
  api?: {
    gemini: ApiEntry
    youtube: ApiEntry
    supadata: ApiEntry
    transcriptapi: ApiEntry
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

        {/* ===== 외부 API 현황 ===== */}
        {s.api && (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionTitleStyle}>{t('adminSystem.apiSectionTitle')}</h2>
            <div style={gridStyle}>
              {([
                // secondMetric: 'avg30d'=최근 30일 하루평균(gemini/youtube), 'month'=이번 달 누적(supadata/transcriptapi)
                // 카드 전체가 각 대시보드로 이동하는 링크 → 인라인 링크·문구는 두지 않는다.
                { key: 'gemini', label: 'Gemini', desc: t('adminSystem.descGemini'), entry: s.api.gemini, secondMetric: 'avg30d' as const, dashUrl: 'https://aistudio.google.com' },
                { key: 'youtube', label: 'YouTube', desc: t('adminSystem.descYoutube'), entry: s.api.youtube, secondMetric: 'avg30d' as const, dashUrl: 'https://console.cloud.google.com' },
                { key: 'supadata', label: 'Supadata', desc: t('adminSystem.descSupadata'), entry: s.api.supadata, secondMetric: 'month' as const, dashUrl: 'https://supadata.ai' },
                { key: 'transcriptapi', label: 'TranscriptAPI', desc: t('adminSystem.descTranscript'), entry: s.api.transcriptapi, secondMetric: 'month' as const, dashUrl: 'https://transcriptapi.com' },
              ]).map(a => {
                const todayCount = a.entry?.today?.count ?? 0
                const monthCount = a.entry?.monthTotal ?? 0
                const avg30d = a.entry?.avg30d ?? 0
                const limit = a.entry?.limit ?? null
                const period = a.entry?.limitPeriod ?? null
                // 막대바 기준값: 월 한도면 이번 달 누적, 일일 한도면 오늘 사용량.
                const barCount = period === 'month' ? monthCount : todayCount
                const pct = limit && limit > 0 ? Math.round((barCount / limit) * 100) : 0
                const overColor = usageColor(pct)
                const barValueColor = pct >= 80 ? overColor : 'var(--text-primary)'
                const limitLabel = period === 'month' ? t('adminSystem.apiLimitMonthly') : t('adminSystem.apiLimitDaily')
                // 둘째 줄: gemini/youtube는 최근 30일 하루평균, 그 외는 이번 달 누적.
                const secondLabel = a.secondMetric === 'avg30d' ? t('adminSystem.apiUsageAvg30d') : t('adminSystem.apiUsageMonth')
                const secondValue = a.secondMetric === 'avg30d' ? nf.format(avg30d) : nf.format(monthCount)
                const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 }
                return (
                  <a key={a.key} href={a.dashUrl} target="_blank" rel="noopener noreferrer"
                    style={{ ...cardStyle, display: 'block', textDecoration: 'none', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{a.desc}</div>

                    {/* 오늘 사용량 + (하루평균 또는 이번 달 누적) */}
                    <div style={{ ...rowStyle, marginTop: 12 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('adminSystem.apiUsageToday')}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{nf.format(todayCount)}</span>
                    </div>
                    <div style={rowStyle}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{secondLabel}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secondValue}</span>
                    </div>

                    {limit != null && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{limitLabel}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: barValueColor }}>
                            {nf.format(barCount)} <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400 }}>/ {nf.format(limit)}</span>
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-subtle)', overflow: 'hidden', marginTop: 6 }}>
                          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: overColor, borderRadius: 999 }} />
                        </div>
                      </div>
                    )}
                  </a>
                )
              })}
            </div>
          </section>
        )}

        {/* ===== 고정비 안내 (카드 클릭 시 해당 대시보드 이동) ===== */}
        <section style={{ marginTop: 28 }}>
          <h2 style={sectionTitleStyle}>{t('adminSystem.costSectionTitle')}</h2>
          <div style={gridStyle}>
            {([
              { key: 'cf', title: 'Cloudflare Workers', value: t('adminSystem.costCloudflareValue'), note: null as string | null, url: 'https://dash.cloudflare.com' },
              { key: 'supabase', title: 'Supabase', value: t('adminSystem.costSupabaseValue'), note: t('adminSystem.costSupabaseNote'), url: 'https://supabase.com/dashboard/project/rqoztfncbgxofxeyguxm' },
              { key: 'supadata', title: 'Supadata', value: t('adminSystem.costSupadataValue'), note: null, url: 'https://supadata.ai' },
              { key: 'transcript', title: 'TranscriptAPI', value: t('adminSystem.costTranscriptValue'), note: null, url: 'https://transcriptapi.com' },
              { key: 'domain', title: `${t('adminSystem.costDomainTitle')} (dailyvideodigest.com)`, value: t('adminSystem.costDomainValue'), note: null, url: 'https://dash.cloudflare.com' },
            ]).map(c => (
              <a key={c.key} href={c.url} target="_blank" rel="noopener noreferrer"
                style={{ ...cardStyle, display: 'block', textDecoration: 'none', cursor: 'pointer' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>{c.value}</div>
                {c.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{c.note}</div>}
              </a>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>{t('adminSystem.costFooter')}</div>
        </section>

        {/* ===== 바로가기 링크 ===== */}
        <section style={{ marginTop: 28, marginBottom: 8 }}>
          <h2 style={sectionTitleStyle}>{t('adminSystem.linksSectionTitle')}</h2>
          <div style={gridStyle}>
            {([
              // 카드 클릭으로 대부분 이동 가능 → 카드와 안 겹치는 3개만 유지.
              { url: 'https://console.cloud.google.com', label: t('adminSystem.linkGcp'), desc: t('adminSystem.linkGcpDesc') },
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
