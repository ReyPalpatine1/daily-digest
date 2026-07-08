'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'
import { Star } from 'lucide-react'

// 관리자 사용자 의견 탭 — feedback 목록 조회 + 상태 변경(new/read/resolved).

type FeedbackRow = {
  id: string
  user_id: string | null
  rating: number | null
  type: string
  message: string
  status: string
  locale: string | null
  created_at: string
  email: string | null
  name: string | null
}

type FeedbackStatus = 'new' | 'read' | 'resolved'

export default function AdminFeedbackPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadRows = useCallback(async (before?: string) => {
    const url = before ? `/api/admin/feedback?before=${encodeURIComponent(before)}` : '/api/admin/feedback'
    const res = await fetch(url)
    if (!res.ok) throw new Error(`feedback fetch failed (${res.status})`)
    return (await res.json()) as { rows: FeedbackRow[]; hasMore: boolean }
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
      try {
        const data = await loadRows()
        if (cancelled) return
        setRows(data.rows)
        setHasMore(data.hasMore)
      } catch (e) {
        console.error('[admin/feedback] 초기 로드 실패:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    checkAdminAndLoad()
    return () => { cancelled = true }
  }, [router, loadRows])

  async function loadMore() {
    if (!rows.length || loadingMore) return
    setLoadingMore(true)
    try {
      const last = rows[rows.length - 1]
      const data = await loadRows(last.created_at)
      setRows(prev => [...prev, ...data.rows])
      setHasMore(data.hasMore)
    } catch (e) {
      console.error('[admin/feedback] 더 보기 실패:', e)
      alert(t('adminErrors.loadFailed'))
    } finally {
      setLoadingMore(false)
    }
  }

  // 상태 변경 — 낙관적 업데이트 후 실패 시 롤백.
  async function changeStatus(id: string, status: FeedbackStatus) {
    const prev = rows
    setRows(list => list.map(r => (r.id === id ? { ...r, status } : r)))
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error(`status update failed (${res.status})`)
    } catch (e) {
      console.error('[admin/feedback] 상태 변경 실패:', e)
      setRows(prev)
    }
  }

  const dateLocale = locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const formatKst = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  const typeLabel = (type: string) =>
    type === 'bug' ? t('feedback.typeBug')
      : type === 'feature' ? t('feedback.typeFeature')
        : t('feedback.typeGeneral')

  const ADMIN_BAR_BG = '#0A0A0A'
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 10,
    padding: 16,
  }

  if (loading || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ height: 56, background: ADMIN_BAR_BG }} />
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          {t('adminErrors.loading')}
        </div>
      </div>
    )
  }

  const statusOptions: FeedbackStatus[] = ['new', 'read', 'resolved']
  const statusLabel: Record<FeedbackStatus, string> = {
    new: t('admin.statusNew'),
    read: t('admin.statusRead'),
    resolved: t('admin.statusResolved'),
  }

  // 상태별 강조 스타일 (선택된 상태만 색 강조, 나머지는 서브톤)
  const statusButtonStyle = (opt: FeedbackStatus, active: boolean): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit', border: 'none',
    }
    if (!active) {
      return {
        ...base,
        background: 'var(--bg-subtle)',
        color: 'var(--text-tertiary)',
        border: '0.5px solid var(--border)',
      }
    }
    if (opt === 'new') return { ...base, background: 'var(--warning)', color: 'var(--bg-card)' }
    if (opt === 'resolved') return { ...base, background: 'var(--success)', color: 'var(--bg-card)' }
    // read
    return { ...base, background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '0.5px solid var(--border)' }
  }

  const submitter = (row: FeedbackRow) => {
    if (!row.email && !row.name) return t('admin.feedbackAnon')
    if (row.email && row.name) return `${row.email} (${row.name})`
    return row.email ?? row.name ?? t('admin.feedbackAnon')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="feedback" />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 20px', color: 'var(--text-primary)', letterSpacing: -0.3 }}>
          {t('admin.feedbackTitle')}
        </h1>

        {rows.length === 0 ? (
          <div style={{ ...cardStyle, padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {t('admin.feedbackEmpty')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map(row => (
              <div key={row.id} style={cardStyle}>
                {/* 상단 줄: 유형 뱃지 + 별점 + 제출자 + 작성일 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
                    background: 'var(--bg-subtle)', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                  }}>
                    {typeLabel(row.type)}
                  </span>

                  {row.rating ? (
                    <span style={{ display: 'inline-flex', gap: 1 }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <Star
                          key={n}
                          size={14}
                          strokeWidth={1.75}
                          style={{ color: n <= row.rating! ? 'var(--accent)' : 'var(--text-muted)' }}
                          fill={n <= row.rating! ? 'var(--accent)' : 'none'}
                        />
                      ))}
                    </span>
                  ) : null}

                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                    {submitter(row)}
                  </span>

                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                    {formatKst(row.created_at)}
                  </span>
                </div>

                {/* 본문 */}
                <div style={{
                  fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 12,
                }}>
                  {row.message}
                </div>

                {/* 상태 컨트롤 */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {statusOptions.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => { if (row.status !== opt) changeStatus(row.id, opt) }}
                      style={statusButtonStyle(opt, row.status === opt)}
                    >
                      {statusLabel[opt]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 더 보기 (페이지당 50건) */}
        {hasMore && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={loadMore} disabled={loadingMore}
              style={{
                padding: '8px 18px', borderRadius: 8,
                border: '0.5px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                cursor: loadingMore ? 'default' : 'pointer', fontFamily: 'inherit',
              }}>
              {loadingMore ? t('adminErrors.loading') : t('adminErrors.loadMore')}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
