'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'
import { ExternalLink, Search, X } from 'lucide-react'

// 관리자 결제 탭 — 환불 문의 대응 시 SQL 없이 화면에서 판단하고,
// "결제는 됐는데 Pro가 안 켜진" 계정을 복구한다.
// 구조·스타일은 app/admin/errors/page.tsx를 그대로 따른다(카드/표/더 보기/시각 포맷).

const STATUS_FILTERS = ['all', 'done', 'failed', 'pending', 'canceled', 'recovery'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]
const PERIOD_FILTERS = ['all', '30', '90', '365'] as const
type PeriodFilter = (typeof PERIOD_FILTERS)[number]

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
  needsRecovery: boolean
  // 등록된 카드(빌링키) 유무. 복구 시 실제 적용될 종류를 미리 계산하는 데만 쓴다.
  hasCard: boolean
  // 계정 상태(플랜·만료일)를 이 행에 표시해도 되는지. 계정 상태는 계정당 하나뿐이라
  // 그 사람의 가장 최근 결제 행에만 표시한다 — 과거 결제 행에 붙이면 그 결제가
  // 그 날짜까지 유효했던 것처럼 읽힌다.
  isLatestForUser: boolean
  recoveredAt: string | null
  recoveredBy: string | null
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

  // search = 입력값, query = 실제 조회에 쓰는 값(디바운스로 반영).
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')

  // 복구 진행 중인 결제 id. 같은 버튼을 두 번 누르지 못하게 막는다.
  const [recoveringId, setRecoveringId] = useState<string | null>(null)
  const [recoverError, setRecoverError] = useState<string | null>(null)
  // 목록을 다시 불러오기 위한 트리거.
  const [reloadKey, setReloadKey] = useState(0)
  // 필터·검색을 바꿔 다시 불러오는 중. 최초 진입(loading)과는 다르다 —
  // 그쪽은 전체 화면 로딩 문구가 따로 있다.
  const [refreshing, setRefreshing] = useState(false)
  const firstLoadDone = useRef(false)

  const fetchPage = useCallback(async (before?: string) => {
    const params = new URLSearchParams()
    if (before) params.set('before', before)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (periodFilter !== 'all') params.set('period', periodFilter)
    if (query) params.set('q', query)
    const qs = params.toString()
    const res = await fetch(`/api/admin/payments${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error(`payments fetch failed (${res.status})`)
    return (await res.json()) as { payments: PaymentRow[]; hasMore: boolean; summary: Summary }
  }, [query, statusFilter, periodFilter])

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

  // 검색어 디바운스 300ms
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // 목록 조회 — 기간·상태·검색어가 바뀌면 커서를 버리고 처음부터 다시 불러온다.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      setLoadFailed(false)
      // 최초 진입은 전체 화면 로딩 문구가 대신하므로 흐리게 처리하지 않는다.
      if (firstLoadDone.current) setRefreshing(true)
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
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
          firstLoadDone.current = true
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [isAdmin, fetchPage, reloadKey])

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
  // 만료일·복구일은 월/일까지만 — 표 안에서 한 줄을 넘기지 않게.
  const formatKstDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      timeZone: 'Asia/Seoul',
      month: 'numeric', day: 'numeric',
    })
  const formatAmount = (amount: number) => `₩${amount.toLocaleString(dateLocale)}`

  // 복구 버튼·확인창이 함께 쓰는 라벨 — 누르면 실제로 적용될 종류를 그대로 말한다.
  // 카드 없는 auto가 onetime으로 낮춰 적용되는 것은 서버 recover 라우트와 같은 규칙이다.
  // 한쪽만 바뀌면 화면이 사실과 어긋나므로 두 곳을 함께 고칠 것.
  const recoverBtnLabel = (row: PaymentRow) => {
    const willDowngrade = row.kind === 'auto' && !row.hasCard
    return willDowngrade || row.kind !== 'auto'
      ? t('adminPayments.recoverBtnOnetime')
      : t('adminPayments.recoverBtnAuto')
  }

  // 복구 실행 — 환불로 내린 계정과 사고로 안 켜진 계정을 시스템이 구분할 수 없으므로
  // (결제 취소 API 미연동) 반드시 사람의 확인을 거친다.
  async function recover(row: PaymentRow) {
    if (recoveringId) return
    // 만료일은 서버 applyPaidPlan과 같은 계산(오늘 + 30일)이다. 화면에서 별도 규칙을 만들지 않는다.
    const expiresPreview = formatKstDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())
    const message =
      `${row.email ?? row.orderId}\n` +
      `${recoverBtnLabel(row)} · ${t('adminPayments.confirmExpires', { date: expiresPreview })}`
    if (!window.confirm(message)) return

    setRecoveringId(row.id)
    setRecoverError(null)
    try {
      const res = await fetch('/api/admin/payments/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: row.id }),
      })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean; error?: string
      }
      if (!res.ok || !data.ok) {
        const errorKey =
          data.error === 'already_recovered' ? 'adminPayments.recoverErrAlreadyRecovered'
            : data.error === 'already_applied' ? 'adminPayments.recoverErrAlreadyApplied'
              : data.error === 'vip' ? 'adminPayments.recoverErrVip'
                : data.error === 'not_paid' ? 'adminPayments.recoverErrNotPaid'
                  : 'adminPayments.recoverFailed'
        setRecoverError(t(errorKey))
        return
      }
      // 복구 결과가 목록·요약에 반영되도록 다시 불러온다.
      // 성공 안내는 따로 두지 않는다 — 그 행이 "복구됨 · 날짜"로 바뀌어 결과가 눈앞에서 확인된다.
      setReloadKey(key => key + 1)
    } catch (e) {
      console.error('[admin/payments] 복구 실패:', e)
      setRecoverError(t('adminPayments.recoverFailed'))
    } finally {
      setRecoveringId(null)
    }
  }

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
  // adminErrors의 "더 보기" 버튼 스타일 — 복구 버튼은 색만 var(--warning)으로 바꿔 쓴다.
  const moreBtnStyle: React.CSSProperties = {
    padding: '8px 18px', borderRadius: 8,
    border: '0.5px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
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
  // 복구할 건이 있을 때만 강조·설명·클릭을 켠다.
  const hasMismatch = (summary?.mismatch ?? 0) > 0

  const summaryCard = (label: string, value: string, highlight = false, onClick?: () => void) => (
    <div
      onClick={onClick}
      style={{
        ...cardStyle, flex: 1, minWidth: 140,
        cursor: onClick ? 'pointer' : 'default',
      }}>
      <div style={{
        fontSize: 20, fontWeight: 600,
        color: highlight ? 'var(--warning)' : 'var(--text-primary)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{label}</div>
    </div>
  )

  const chip = (active: boolean, label: string, onClick: () => void, key: string) => (
    <button key={key} onClick={onClick}
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

  // 재조회 중 표시 — 표를 비우고 "불러오는 중"을 띄우면 화면이 깜빡이며 스크롤이 튄다.
  // 필터는 연달아 누르는 동작이라 이전 결과가 자리를 지키는 편이 안정적이다.
  const refreshingStyle: React.CSSProperties = {
    transition: 'opacity 0.15s',
    ...(refreshing ? { opacity: 0.45, pointerEvents: 'none' as const } : null),
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

        {/* 요약 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: hasMismatch ? 8 : 16, ...refreshingStyle }}>
          {summaryCard(t('adminPayments.summaryCount'), String(summary?.count ?? 0))}
          {summaryCard(t('adminPayments.summaryAmount'), formatAmount(summary?.amount ?? 0))}
          {summaryCard(t('adminPayments.summaryFailed'), String(summary?.failed ?? 0))}
          {/* 복구할 건이 있으면 눌러서 바로 그 목록으로 간다. */}
          {summaryCard(
            t('adminPayments.summaryMismatch'),
            String(summary?.mismatch ?? 0),
            hasMismatch,
            hasMismatch ? () => setStatusFilter('recovery') : undefined,
          )}
        </div>
        {hasMismatch && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            {t('adminPayments.summaryMismatchNote')}
          </div>
        )}

        {/* 검색 — 이메일·주문번호는 길어서 한 줄을 통째로 쓴다. */}
        <div style={{ position: 'relative', width: '100%', marginBottom: 8 }}>
          <Search size={14} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('adminPayments.searchPlaceholder')}
            style={{
              width: '100%',
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 8, padding: '8px 12px', paddingLeft: 30, paddingRight: 32,
              color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }} />
          {/* 지우기만 한다 — 재조회는 디바운스가 알아서 한다. */}
          {search && (
            <span onClick={() => setSearch('')}
              style={{
                position: 'absolute', right: 10, top: '50%',
                transform: 'translateY(-50%)',
                display: 'inline-flex', cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
              <X size={14} />
            </span>
          )}
        </div>

        {/* 상태 · 기간 — 상태는 자주 오가므로 버튼으로 두고,
            기간은 한 번 정하면 잘 안 바꾸는 값이라 접는다. */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {chip(statusFilter === 'all', t('adminPayments.filterAll'), () => setStatusFilter('all'), 's-all')}
            {chip(statusFilter === 'done', t('adminPayments.filterDone'), () => setStatusFilter('done'), 's-done')}
            {chip(statusFilter === 'failed', t('adminPayments.filterFailed'), () => setStatusFilter('failed'), 's-failed')}
            {chip(statusFilter === 'pending', t('adminPayments.filterPending'), () => setStatusFilter('pending'), 's-pending')}
            {chip(statusFilter === 'canceled', t('adminPayments.filterCanceled'), () => setStatusFilter('canceled'), 's-canceled')}
            {chip(statusFilter === 'recovery', t('adminPayments.filterRecovery'), () => setStatusFilter('recovery'), 's-recovery')}
          </div>
          <select
            value={periodFilter}
            onChange={e => setPeriodFilter(e.target.value as PeriodFilter)}
            style={{
              flexShrink: 0,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 7, padding: '5px 10px', fontSize: 12,
              color: 'var(--text-secondary)', fontFamily: 'inherit',
              cursor: 'pointer', outline: 'none',
            }}>
            <option value="all">{t('adminPayments.periodAll')}</option>
            <option value="30">{t('adminPayments.period30')}</option>
            <option value="90">{t('adminPayments.period90')}</option>
            <option value="365">{t('adminPayments.period365')}</option>
          </select>
        </div>

        {recoverError && (
          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10 }}>
            {recoverError}
          </div>
        )}
        {loadFailed && (
          <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10 }}>
            {t('adminPayments.loadFailed')}
          </div>
        )}

        {/* 결제 목록 */}
        <div style={{ ...cardStyle, padding: 0, overflowX: 'auto', ...refreshingStyle }}>
          {rows.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('adminPayments.empty')}
            </div>
          ) : (
            <table style={{ width: '100%', minWidth: 1020, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('adminPayments.colTime')}</th>
                  <th style={thStyle}>{t('adminPayments.colUser')}</th>
                  <th style={thStyle}>{t('adminPayments.colPaymentOutcome')}</th>
                  <th style={thStyle}>{t('adminPayments.colAmount')}</th>
                  <th style={thStyle}>{t('adminPayments.colStatus')}</th>
                  <th style={thStyle}>{t('adminPayments.colSentAfter')}</th>
                  <th style={thStyle}>{t('adminPayments.colRecover')}</th>
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
                    {/* 결제 후 상태 — 윗줄은 이 결제가 어떻게 끝났는지, 아랫줄은 계정의 현재 상태. */}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div>
                        {row.kind === 'auto' ? t('adminPayments.kindAuto') : t('adminPayments.kindOnetime')}
                        {/* 화살표는 "결제와 결과가 어긋난 경우"에만 쓴다. 만료·해지·결제 실패는
                            정상 동작이라 붙이지 않는다 — 붙이면 화살표가 신호이기를 그만둔다. */}
                        {row.needsRecovery ? (
                          <>
                            {' → '}
                            <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                              {t('adminPayments.outcomeFailed')}
                            </span>
                          </>
                        ) : row.kind === 'auto' && row.recoveredAt && row.planStatus === 'onetime' ? (
                          <>
                            {' → '}
                            <span style={{ color: 'var(--text-tertiary)' }}>
                              {t('adminPayments.kindOnetime')}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {/* 계정 상태는 계정당 하나뿐이라 그 사람의 가장 최근 결제 행에만 붙인다. */}
                      {row.isLatestForUser && row.plan && (
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                          {row.plan.toUpperCase()}
                          {row.plan !== 'free' && row.planExpiresAt
                            ? ` · ${formatKstDate(row.planExpiresAt)}`
                            : ''}
                        </div>
                      )}
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
                      {row.needsRecovery ? (
                        <button
                          onClick={() => recover(row)}
                          disabled={recoveringId !== null}
                          style={{
                            ...moreBtnStyle,
                            color: 'var(--warning)',
                            cursor: recoveringId !== null ? 'default' : 'pointer',
                          }}>
                          {/* 버튼이 곧 결과 안내다 — 눌렀을 때 실제로 적용될 종류를 라벨에 쓴다. */}
                          {recoverBtnLabel(row)}
                        </button>
                      ) : row.recoveredAt ? (
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {t('adminPayments.recoveredDone', { date: formatKstDate(row.recoveredAt) })}
                        </span>
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
              style={{ ...moreBtnStyle, cursor: loadingMore ? 'default' : 'pointer' }}>
              {loadingMore ? t('adminPayments.loading') : t('adminPayments.loadMore')}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
