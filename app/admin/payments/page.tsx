'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'
import { ExternalLink } from 'lucide-react'

// 관리자 결제 탭 — 환불 문의 대응 시 SQL 없이 화면에서 판단하기 위한 조회 전용 화면.
// 구조·스타일은 app/admin/errors/page.tsx를 그대로 따른다(카드/표/더 보기/시각 포맷).
// ★ 조회만 한다 — 플랜 변경·환불·상태 수정 기능은 여기에 두지 않는다.

const STATUS_FILTERS = ['all', 'done', 'failed', 'pending', 'canceled'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

type PaymentRow = {
  id: string
  orderId: string
  createdAt: string
  amount: number
  kind: string
  status: string
  receiptUrl: string | null
  failCode: string | null
  email: string | null
  plan: string | null
  planStatus: string | null
  planExpiresAt: string | null
  // done 결제에만 값이 있다. 결제 시각 이후 다이제스트 발송 건수 — 환불 가부의 판단 근거.
  sentAfter: number | null
}

type Summary = { count: number; amount: number; failed: number; mismatch: number }

export default function AdminPaymentsPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const [rows, setRows] = useState<PaymentRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  // search = 입력값, query = 실제 조회에 쓰는 값(디바운스/Enter로 반영).
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const fetchPage = useCallback(async (before?: string) => {
    const params = new URLSearchParams()
    if (before) params.set('before', before)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (query) params.set('q', query)
    const qs = params.toString()
    const res = await fetch(`/api/admin/payments${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error(`payments fetch failed (${res.status})`)
    return (await res.json()) as { payments: PaymentRow[]; hasMore: boolean; summary: Summary }
  }, [query, statusFilter])

  useEffect(() => {
    let cancelled = false
    async function checkAdmin() {
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
    }
    checkAdmin()
    return () => { cancelled = true }
  }, [router])

  // 검색어 디바운스 300ms — Enter를 누르면 아래 onKeyDown이 먼저 반영한다.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // 목록 조회 — 검색어·필터가 바뀌면 커서를 버리고 처음부터 다시 불러온다.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      setLoadFailed(false)
      try {
        const data = await fetchPage()
        if (cancelled) return
        setRows(data.payments)
        setHasMore(data.hasMore)
        setSummary(data.summary)
      } catch (e) {
        console.error('[admin/payments] 조회 실패:', e)
        if (cancelled) return
        setRows([])
        setHasMore(false)
        setLoadFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isAdmin, fetchPage])

  async function loadMore() {
    if (!rows.length || loadingMore) return
    setLoadingMore(true)
    try {
      const last = rows[rows.length - 1]
      const data = await fetchPage(last.createdAt)
      setRows(prevList => [...prevList, ...data.payments])
      setHasMore(data.hasMore)
    } catch (e) {
      console.error('[admin/payments] 더 보기 실패:', e)
      setLoadFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const dateLocale = locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const formatKst = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, {
      timeZone: 'Asia/Seoul',
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  // 만료일은 월/일까지만 — 표 안에서 한 줄을 넘기지 않게.
  const formatKstDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      timeZone: 'Asia/Seoul',
      month: 'numeric', day: 'numeric',
    })
  const formatAmount = (amount: number) => `₩${amount.toLocaleString(dateLocale)}`

  const ADMIN_BAR_BG = '#0A0A0A'
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 10,
    padding: 16,
  }
  const thStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
    padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'left',
    borderBottom: '0.5px solid var(--border)', background: 'var(--bg-subtle)',
  }
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', borderBottom: '0.5px solid var(--border-light)',
    verticalAlign: 'top', fontSize: 12, color: 'var(--text-secondary)',
  }

  if (loading || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ height: 56, background: ADMIN_BAR_BG }} />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          {t('adminPayments.loading')}
        </div>
      </div>
    )
  }

  const noData = <span style={{ color: 'var(--text-muted)' }}>{t('adminPayments.noData')}</span>
  // 결제됐는데 free인 계정이 있을 때만 강조·설명을 켠다.
  const hasMismatch = (summary?.mismatch ?? 0) > 0

  // 요약 카드 — 숫자 20px/600, 라벨 11px.
  const summaryCard = (label: string, value: string, highlight = false) => (
    <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
      <div style={{
        fontSize: 20, fontWeight: 600,
        color: highlight ? 'var(--warning)' : 'var(--text-primary)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{label}</div>
    </div>
  )

  const filterChip = (key: StatusFilter, label: string) => {
    const active = statusFilter === key
    return (
      <button key={key} onClick={() => setStatusFilter(key)}
        style={{
          padding: '5px 12px', borderRadius: 7, border: 'none',
          background: active ? 'var(--bg-subtle)' : 'transparent',
          color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
        {label}
      </button>
    )
  }

  // 상태 뱃지 — adminErrors의 source 뱃지 모양을 그대로 쓰고 색만 나눈다.
  // canceled는 "취소"가 아니라 "중복 차단"이다: 토스에 승인 요청을 보내기 전에 막은 것이라
  // 청구가 발생하지 않았고, 나중에 결제 취소 API를 붙이면 실제 환불 건과 구분되어야 한다.
  const statusBadge = (status: string) => {
    const badgeStyle: React.CSSProperties = {
      fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 4,
      whiteSpace: 'nowrap', display: 'inline-block',
    }
    if (status === 'done') {
      return <span style={{ ...badgeStyle, background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>{t('adminPayments.statusDone')}</span>
    }
    if (status === 'failed') {
      return <span style={{ ...badgeStyle, color: 'var(--warning)' }}>{t('adminPayments.statusFailed')}</span>
    }
    if (status === 'pending') {
      return <span style={{ ...badgeStyle, color: 'var(--text-muted)' }}>{t('adminPayments.statusPending')}</span>
    }
    if (status === 'canceled') {
      return <span style={{ ...badgeStyle, color: 'var(--text-muted)' }}>{t('adminPayments.statusCanceled')}</span>
    }
    // 알 수 없는 값이 들어와도 화면이 비지 않게 원문을 그대로 보여준다.
    return <span style={{ ...badgeStyle, color: 'var(--text-muted)' }}>{status}</span>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="payments" />

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: 'var(--text-primary)', letterSpacing: -0.3 }}>
          {t('adminPayments.title')}
        </h1>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 20 }}>
          {t('adminPayments.subtitle')}
        </div>

        {/* 요약 (최근 30일 · 검색/필터와 무관) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: hasMismatch ? 8 : 16 }}>
          {summaryCard(t('adminPayments.summaryCount'), String(summary?.count ?? 0))}
          {summaryCard(t('adminPayments.summaryAmount'), formatAmount(summary?.amount ?? 0))}
          {summaryCard(t('adminPayments.summaryFailed'), String(summary?.failed ?? 0))}
          {summaryCard(t('adminPayments.summaryMismatch'), String(summary?.mismatch ?? 0), hasMismatch)}
        </div>
        {/* 불일치가 있을 때만 설명을 붙인다 — 0이면 볼 것이 없으므로 강조도 설명도 없다. */}
        {hasMismatch && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            {t('adminPayments.summaryMismatchNote')}
          </div>
        )}

        {/* 검색 + 상태 필터 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setQuery(search.trim()) } }}
            placeholder={t('adminPayments.searchPlaceholder')}
            style={{
              flex: 1, minWidth: 200,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filterChip('all', t('adminPayments.filterAll'))}
            {filterChip('done', t('adminPayments.filterDone'))}
            {filterChip('failed', t('adminPayments.filterFailed'))}
            {filterChip('pending', t('adminPayments.filterPending'))}
            {filterChip('canceled', t('adminPayments.filterCanceled'))}
          </div>
        </div>

        {loadFailed && (
          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10 }}>
            {t('adminPayments.loadFailed')}
          </div>
        )}

        {/* 결제 목록 */}
        <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
          {rows.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('adminPayments.empty')}
            </div>
          ) : (
            <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('adminPayments.colTime')}</th>
                  <th style={thStyle}>{t('adminPayments.colUser')}</th>
                  <th style={thStyle}>{t('adminPayments.colKind')}</th>
                  <th style={thStyle}>{t('adminPayments.colAmount')}</th>
                  <th style={thStyle}>{t('adminPayments.colStatus')}</th>
                  <th style={thStyle}>{t('adminPayments.colSentAfter')}</th>
                  <th style={thStyle}>{t('adminPayments.colPlanNow')}</th>
                  <th style={thStyle}>{t('adminPayments.colOrderId')}</th>
                  <th style={thStyle}>{t('adminPayments.colReceipt')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>
                      {formatKst(row.createdAt)}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.email ?? noData}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {row.kind === 'auto' ? t('adminPayments.kindAuto') : t('adminPayments.kindOnetime')}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {formatAmount(row.amount)}
                    </td>
                    <td style={tdStyle}>
                      {statusBadge(row.status)}
                      {row.status === 'failed' && row.failCode && (
                        <div style={{ fontSize: 10.5, fontFamily: 'monospace', color: 'var(--text-muted)', marginTop: 3 }}>
                          {row.failCode}
                        </div>
                      )}
                    </td>
                    {/* 0이면 환불 대상일 수 있다는 뜻이라 눈에 띄어야 한다. */}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {row.sentAfter === null ? noData : (
                        <span style={{ color: row.sentAfter === 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                          {t('adminPayments.sentUnit', { n: row.sentAfter })}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {row.plan ? (
                        <>
                          <div>{row.plan.toUpperCase()}</div>
                          {(row.planStatus || row.planExpiresAt) && (
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                              {row.planStatus ?? ''}
                              {row.planExpiresAt ? `${row.planStatus ? ' · ' : ''}${formatKstDate(row.planExpiresAt)}` : ''}
                            </div>
                          )}
                        </>
                      ) : noData}
                    </td>
                    <td
                      title={row.orderId}
                      style={{
                        ...tdStyle, fontFamily: 'monospace', fontSize: 11,
                        color: 'var(--text-tertiary)', maxWidth: 180,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                      {row.orderId}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {row.receiptUrl ? (
                        <a href={row.receiptUrl} target="_blank" rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            color: 'var(--text-primary)', textDecoration: 'none',
                          }}>
                          <ExternalLink size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          {t('adminPayments.receipt')}
                        </a>
                      ) : noData}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
              {loadingMore ? t('adminPayments.loading') : t('adminPayments.loadMore')}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
