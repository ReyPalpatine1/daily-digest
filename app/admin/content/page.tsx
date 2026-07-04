'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'

// /admin(대시보드)의 "인기 콘텐츠" 섹션을 분리한 페이지.
// 데이터는 기존 /api/admin/usage 응답의 topChannels를 그대로 재사용한다.
type ContentStats = {
  generatedAt: string
  topChannels: { name: string; category: string | null; subscribers: number }[]
}

export default function AdminContentPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [stats, setStats] = useState<ContentStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/usage')
      if (res.ok) {
        setStats(await res.json())
      }
    } catch (e) {
      console.error('[admin/content] loadStats failed:', e)
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="content" />

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
            {t('admin.sec6')}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
            {new Date(s.generatedAt).toLocaleString(dateLocale)} · {t('admin.subtitle')}
          </div>
        </div>

        <div style={{ ...cardStyle, maxWidth: 640 }}>
          {s.topChannels.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {t('admin.empty')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {s.topChannels.map((ch, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px',
                  borderBottom: i < s.topChannels.length - 1 ? '0.5px solid var(--border-light)' : 'none',
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
      </main>
    </div>
  )
}
