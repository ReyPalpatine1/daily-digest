'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'

// /admin(대시보드)의 "시스템 상태" 섹션을 분리한 페이지.
// 데이터는 기존 /api/admin/usage 응답의 system을 그대로 재사용한다.
// (외부 API 현황판·링크 모음은 2단계에서 이 페이지에 추가 예정)
type SystemStats = {
  generatedAt: string
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
      </main>
    </div>
  )
}
