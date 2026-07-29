'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { usePending } from '@/lib/use-pending'
import { AdminHeader } from '@/components/AdminHeader'
import { ExternalLink, Ban, ShieldCheck, Eraser } from 'lucide-react'

// 관리자 공유 신고 탭 — 사유 필터 + 목록. 카드 클릭=읽음(new→read).
// 의견 탭(app/admin/feedback/page.tsx)의 레이아웃·카드·필터·페이지네이션 패턴을 그대로 따르고,
// 신고 특유의 조치(메모 삭제·링크 차단·차단 해제)를 더한 화면.

// 공유 현황 — shared_summaries 행이 이미 지워졌으면 share=null 로 내려온다.
type ShareState = {
  comment: string | null
  blocked_at: string | null
  expires_at: string | null
}

type ReportRow = {
  id: string
  token: string
  video_id: string | null
  shared_by: string | null
  comment_snapshot: string | null
  reason: string
  detail: string | null
  status: string
  created_at: string
  video_title: string | null
  shared_by_email: string | null
  shared_by_name: string | null
  share: ShareState | null
  report_count: number
}

type ReportStatus = 'new' | 'read' | 'resolved'
type FilterReason = 'all' | 'abuse' | 'privacy' | 'other'
type ReportAction = 'clear_comment' | 'block' | 'unblock'

// 신고 사유 라벨 — 관리자 알림(lib/share-report.ts SHARE_REPORT_REASON_LABEL)과 동일하게 한국어 고정.
// lib/share-report.ts는 SUPABASE_SERVICE_KEY를 쓰는 서버 전용 모듈이라 클라이언트에서 import하지 않는다.
const REASON_LABEL: Record<string, string> = {
  abuse: '욕설 · 비방',
  privacy: '개인정보 노출',
  other: '기타',
}

export default function AdminReportsPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const [rows, setRows] = useState<ReportRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filterReason, setFilterReason] = useState<FilterReason>('all')
  // 미확인(new) 카운트 — 헤더 뱃지에 실시간 반영(초기값은 count API 권위값).
  const [newCount, setNewCount] = useState(0)
  // 조치 버튼 공용 진행 상태 — 진행 중에는 모든 조치 버튼을 잠가 동시 조치를 막는다.
  const { pending: actionPending, run: runAction } = usePending()

  // reason/before 를 반영한 목록 조회.
  const loadRows = useCallback(async (reason: FilterReason, before?: string) => {
    const params = new URLSearchParams()
    if (reason !== 'all') params.set('reason', reason)
    if (before) params.set('before', before)
    const qs = params.toString()
    const res = await fetch(`/api/admin/reports${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error(`reports fetch failed (${res.status})`)
    return (await res.json()) as { rows: ReportRow[]; hasMore: boolean }
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
        const data = await loadRows('all')
        if (cancelled) return
        setRows(data.rows)
        setHasMore(data.hasMore)
      } catch (e) {
        console.error('[admin/reports] 초기 로드 실패:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
      // new 카운트 권위값 — 실패 시 조용히 0 유지.
      try {
        const res = await fetch('/api/admin/reports/count')
        if (!cancelled && res.ok) {
          const data = await res.json()
          setNewCount(data.newCount ?? 0)
        }
      } catch { /* 무시 */ }
    }
    checkAdminAndLoad()
    return () => { cancelled = true }
  }, [router, loadRows])

  // 사유 필터 변경 — 목록을 처음부터 다시 로드(before 커서 초기화).
  async function applyFilter(next: FilterReason) {
    if (next === filterReason) return
    setFilterReason(next)
    try {
      const data = await loadRows(next)
      setRows(data.rows)
      setHasMore(data.hasMore)
    } catch (e) {
      console.error('[admin/reports] 필터 로드 실패:', e)
    }
  }

  async function loadMore() {
    if (!rows.length || loadingMore) return
    setLoadingMore(true)
    try {
      const last = rows[rows.length - 1]
      const data = await loadRows(filterReason, last.created_at)
      setRows(prev => [...prev, ...data.rows])
      setHasMore(data.hasMore)
    } catch (e) {
      console.error('[admin/reports] 더 보기 실패:', e)
      alert(t('adminErrors.loadFailed'))
    } finally {
      setLoadingMore(false)
    }
  }

  // 상태 변경 — 낙관적 업데이트 후 실패 시 롤백. new에서 빠지면 헤더 뱃지 카운트도 즉시 보정.
  async function changeStatus(id: string, status: ReportStatus) {
    const prev = rows
    const oldStatus = rows.find(r => r.id === id)?.status
    const decremented = oldStatus === 'new' && status !== 'new'
    if (decremented) setNewCount(c => Math.max(0, c - 1))
    setRows(list => list.map(r => (r.id === id ? { ...r, status } : r)))
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error(`status update failed (${res.status})`)
    } catch (e) {
      console.error('[admin/reports] 상태 변경 실패:', e)
      setRows(prev)
      if (decremented) setNewCount(c => c + 1)
    }
  }

  // 조치 실행 — 확인 창 → POST → 같은 token의 행들을 서버 응답값으로 갱신.
  // 목록을 다시 불러오지 않고 제자리에서 반영해 "더 보기"로 쌓아둔 페이지를 잃지 않는다.
  async function runReportAction(token: string, action: ReportAction, confirmMessage: string) {
    if (actionPending) return
    if (!confirm(confirmMessage)) return
    await runAction(async () => {
      try {
        const res = await fetch('/api/admin/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, action }),
        })
        if (!res.ok) {
          if (res.status === 404) {
            alert('이미 삭제·정리된 공유입니다.')
            return
          }
          throw new Error(`action failed (${res.status})`)
        }
        const data = await res.json() as { ok?: boolean; resolved?: boolean; share?: ShareState }
        const share = data.share ?? null
        // 서버가 신고 일괄 처리까지 성공한 경우에만 상태를 resolved로 반영.
        const resolvedNow = data.resolved === true
        // new에서 빠지는 건수만큼 헤더 뱃지 카운트도 보정(상태 변경과 동일 규칙).
        const cleared = resolvedNow ? rows.filter(r => r.token === token && r.status === 'new').length : 0
        setRows(list => list.map(r => (
          r.token === token
            ? { ...r, share: share ?? r.share, status: resolvedNow ? 'resolved' : r.status }
            : r
        )))
        if (cleared > 0) setNewCount(c => Math.max(0, c - cleared))
      } catch (e) {
        console.error('[admin/reports] 조치 실패:', e)
        alert('조치에 실패했습니다.')
      }
    })
  }

  const dateLocale = locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const formatKst = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  const reasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason

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

  // 공유자 식별 정보 — 이메일 우선, 둘 다 없으면 UUID, 그마저 없으면 탈퇴/미상 처리.
  const sharer = (row: ReportRow) => {
    if (row.shared_by_email && row.shared_by_name) return `${row.shared_by_email} (${row.shared_by_name})`
    if (row.shared_by_email) return row.shared_by_email
    if (row.shared_by_name) return row.shared_by_name
    return row.shared_by ?? t('admin.feedbackAnon')
  }

  const filterOptions: { value: FilterReason; label: string }[] = [
    { value: 'all', label: t('admin.filterAll') },
    { value: 'abuse', label: REASON_LABEL.abuse },
    { value: 'privacy', label: REASON_LABEL.privacy },
    { value: 'other', label: REASON_LABEL.other },
  ]

  const filterButtonStyle = (selected: boolean): React.CSSProperties => ({
    padding: '6px 13px', borderRadius: 7, fontSize: 13, fontWeight: 500,
    cursor: selected ? 'default' : 'pointer', fontFamily: 'inherit',
    background: selected ? 'var(--text-primary)' : 'var(--bg-subtle)',
    color: selected ? 'var(--bg-card)' : 'var(--text-secondary)',
    border: selected ? 'none' : '0.5px solid var(--border)',
  })

  const actionButtonStyle = (danger: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 500,
    fontFamily: 'inherit', cursor: actionPending ? 'default' : 'pointer',
    background: 'var(--bg-card)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    border: `0.5px solid ${danger ? 'var(--danger)' : 'var(--border)'}`,
    opacity: actionPending ? 0.55 : 1,
  })

  const metaRowStyle: React.CSSProperties = {
    display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)',
    lineHeight: 1.6, wordBreak: 'break-word',
  }
  const metaLabelStyle: React.CSSProperties = {
    flexShrink: 0, minWidth: 74, color: 'var(--text-tertiary)',
  }
  const badgeStyle = (tone: 'muted' | 'danger'): React.CSSProperties => ({
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap',
    background: 'var(--bg-subtle)',
    color: tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="reports" reportsNew={newCount} />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 20px', color: 'var(--text-primary)', letterSpacing: -0.3 }}>
          {t('admin.reportsTitle')}
        </h1>

        {/* 사유 필터 바 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {filterOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => applyFilter(opt.value)}
              style={filterButtonStyle(filterReason === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div style={{ ...cardStyle, padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {t('admin.reportsEmpty')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map(row => {
              const isNew = row.status === 'new'
              const isResolved = row.status === 'resolved'
              const share = row.share
              const isBlocked = !!share?.blocked_at
              const isExpired = !!share?.expires_at && new Date(share.expires_at) <= new Date()
              const commentCleared = !!share && share.comment === null

              return (
                <div
                  key={row.id}
                  onClick={() => { if (isNew) changeStatus(row.id, 'read') }}
                  style={{
                    ...cardStyle,
                    ...(isNew
                      ? { border: '0.5px solid var(--warning)', borderLeft: '3px solid var(--warning)' }
                      : {}),
                    opacity: isResolved ? 0.72 : 1,
                    cursor: isNew ? 'pointer' : 'default',
                  }}
                >
                  {/* 상단 줄: 사유 뱃지 + 상태 뱃지 + 누적 신고 수 + 신고 시각 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={badgeStyle('danger')}>{reasonLabel(row.reason)}</span>

                    {row.report_count > 1 && (
                      <span style={badgeStyle('muted')}>누적 신고 {row.report_count}건</span>
                    )}
                    {isBlocked && <span style={badgeStyle('danger')}>차단됨</span>}
                    {isExpired && <span style={badgeStyle('muted')}>만료됨</span>}
                    {!share && <span style={badgeStyle('muted')}>공유가 만료 · 삭제됨</span>}

                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {formatKst(row.created_at)}
                    </span>
                  </div>

                  {/* 상세 내용 */}
                  <div style={{
                    fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 12,
                  }}>
                    {row.detail?.trim() ? row.detail : <span style={{ color: 'var(--text-muted)' }}>(상세 내용 없음)</span>}
                  </div>

                  {/* 대상 공유 정보 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>영상</span>
                      <span>{row.video_title ?? '(알 수 없음)'}</span>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>공유 토큰</span>
                      <a
                        href={`/s/${row.token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all',
                        }}
                      >
                        {row.token}
                        <ExternalLink size={12} strokeWidth={1.75} />
                      </a>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>공유자</span>
                      <span style={{ wordBreak: 'break-all' }}>{sharer(row)}</span>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>메모 원문</span>
                      <span style={{ whiteSpace: 'pre-wrap' }}>
                        {row.comment_snapshot?.trim()
                          ? row.comment_snapshot
                          : <span style={{ color: 'var(--text-muted)' }}>(메모 없음)</span>}
                      </span>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>현재 메모</span>
                      <span style={{ whiteSpace: 'pre-wrap' }}>
                        {!share
                          ? <span style={{ color: 'var(--text-muted)' }}>(공유 없음)</span>
                          : commentCleared
                            ? <span style={{ color: 'var(--text-muted)' }}>삭제됨</span>
                            : share.comment}
                      </span>
                    </div>
                  </div>

                  {/* 조치 버튼 — 공유가 이미 삭제됐으면 감춘다. */}
                  {share ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={actionPending || commentCleared}
                        onClick={() => runReportAction(row.token, 'clear_comment', '이 공유의 메모를 삭제할까요?')}
                        style={{ ...actionButtonStyle(false), opacity: actionPending || commentCleared ? 0.55 : 1, cursor: actionPending || commentCleared ? 'default' : 'pointer' }}
                      >
                        <Eraser size={13} strokeWidth={1.75} />
                        메모 삭제
                      </button>

                      {!isBlocked ? (
                        <button
                          type="button"
                          disabled={actionPending}
                          onClick={() => runReportAction(row.token, 'block', '이 공유 링크를 차단할까요? 공유 페이지가 비공개 처리됩니다.')}
                          style={actionButtonStyle(true)}
                        >
                          <Ban size={13} strokeWidth={1.75} />
                          링크 차단
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={actionPending}
                          onClick={() => runReportAction(row.token, 'unblock', '이 공유 링크의 차단을 해제할까요?')}
                          style={actionButtonStyle(false)}
                        >
                          <ShieldCheck size={13} strokeWidth={1.75} />
                          차단 해제
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      공유가 만료 · 삭제됨
                    </div>
                  )}
                </div>
              )
            })}
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
