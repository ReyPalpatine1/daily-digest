'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'
import { Mail, Send, ExternalLink } from 'lucide-react'

// 관리자 오류 로그 탭 — 알림 설정(이메일/텔레그램, 중복 가능) + error_log 목록 조회.

type ErrorRow = {
  id: string
  occurred_at: string
  source: string
  video_id: string | null
  video_title: string | null
  channel_name: string | null
  fail_reason: string | null
  fail_detail: string | null
}

type AlertSettings = {
  notify_email: boolean
  notify_telegram: boolean
  telegramLinked: boolean
}

export default function AdminErrorsPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const [alertSettings, setAlertSettings] = useState<AlertSettings | null>(null)
  const [saving, setSaving] = useState(false)

  const [errors, setErrors] = useState<ErrorRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadErrors = useCallback(async (before?: string) => {
    const url = before ? `/api/admin/errors?before=${encodeURIComponent(before)}` : '/api/admin/errors'
    const res = await fetch(url)
    if (!res.ok) throw new Error(`errors fetch failed (${res.status})`)
    return (await res.json()) as { errors: ErrorRow[]; hasMore: boolean }
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
        const [settingsRes, errorsData] = await Promise.all([
          fetch('/api/admin/alert-settings'),
          loadErrors(),
        ])
        if (cancelled) return
        if (settingsRes.ok) setAlertSettings(await settingsRes.json())
        setErrors(errorsData.errors)
        setHasMore(errorsData.hasMore)
      } catch (e) {
        console.error('[admin/errors] 초기 로드 실패:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    checkAdminAndLoad()
    return () => { cancelled = true }
  }, [router, loadErrors])

  // 체크박스 변경 즉시 저장 (실패 시 이전 값으로 롤백)
  async function updateAlertSettings(next: { notify_email: boolean; notify_telegram: boolean }) {
    if (!alertSettings || saving) return
    const prev = alertSettings
    setAlertSettings({ ...alertSettings, ...next })
    setSaving(true)
    try {
      const res = await fetch('/api/admin/alert-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) throw new Error(`save failed (${res.status})`)
    } catch (e) {
      console.error('[admin/errors] 설정 저장 실패:', e)
      setAlertSettings(prev)
      alert(t('adminErrors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function loadMore() {
    if (!errors.length || loadingMore) return
    setLoadingMore(true)
    try {
      const last = errors[errors.length - 1]
      const data = await loadErrors(last.occurred_at)
      setErrors(prevList => [...prevList, ...data.errors])
      setHasMore(data.hasMore)
    } catch (e) {
      console.error('[admin/errors] 더 보기 실패:', e)
      alert(t('adminErrors.loadFailed'))
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
          {t('adminErrors.loading')}
        </div>
      </div>
    )
  }

  // 알림 수단 체크박스 (이메일/텔레그램 — 중복 선택 가능)
  const alertCheckbox = (
    key: 'notify_email' | 'notify_telegram',
    label: string,
    Icon: typeof Mail,
  ) => {
    const checked = alertSettings?.[key] === true
    return (
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        fontSize: 13, color: 'var(--text-primary)',
        cursor: saving ? 'default' : 'pointer', userSelect: 'none',
      }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={saving || !alertSettings}
          onChange={e => {
            if (!alertSettings) return
            updateAlertSettings({
              notify_email: key === 'notify_email' ? e.target.checked : alertSettings.notify_email,
              notify_telegram: key === 'notify_telegram' ? e.target.checked : alertSettings.notify_telegram,
            })
          }}
          style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'inherit' }}
        />
        <Icon size={14} style={{ color: 'var(--text-tertiary)' }} />
        {label}
      </label>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      <AdminHeader activeKey="errors" />

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 20px', color: 'var(--text-primary)', letterSpacing: -0.3 }}>
          {t('adminErrors.title')}
        </h1>

        {/* 알림 설정 */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{
            fontSize: 11, color: 'var(--text-tertiary)',
            letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600, marginBottom: 12,
          }}>
            {t('adminErrors.alertSection')}
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            {alertCheckbox('notify_email', t('adminErrors.notifyEmail'), Mail)}
            {alertCheckbox('notify_telegram', t('adminErrors.notifyTelegram'), Send)}
          </div>
          {alertSettings?.notify_telegram && !alertSettings.telegramLinked && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
              {t('adminErrors.telegramNotLinked')}
            </div>
          )}
        </div>

        {/* 오류 목록 */}
        <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
          {errors.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('adminErrors.empty')}
            </div>
          ) : (
            <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('adminErrors.colTime')}</th>
                  <th style={thStyle}>{t('adminErrors.colSource')}</th>
                  <th style={thStyle}>{t('adminErrors.colVideo')}</th>
                  <th style={thStyle}>{t('adminErrors.colChannel')}</th>
                  <th style={thStyle}>{t('adminErrors.colReason')}</th>
                  <th style={{ ...thStyle, width: '32%' }}>{t('adminErrors.colDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {errors.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <tr key={row.id}>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>
                        {formatKst(row.occurred_at)}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 4,
                          background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                        }}>
                          {row.source}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 260 }}>
                        {row.video_id ? (
                          <a href={`https://youtube.com/watch?v=${row.video_id}`} target="_blank" rel="noreferrer"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              color: 'var(--text-primary)', textDecoration: 'none',
                            }}>
                            <span style={{
                              maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              display: 'inline-block', verticalAlign: 'bottom',
                            }}>
                              {row.video_title ?? row.video_id}
                            </span>
                            <ExternalLink size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          </a>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.channel_name ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {row.fail_reason ?? '—'}
                      </td>
                      <td
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        style={{
                          ...tdStyle,
                          fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary)',
                          cursor: row.fail_detail ? 'pointer' : 'default',
                          maxWidth: 320,
                          ...(expanded
                            ? { whiteSpace: 'normal', wordBreak: 'break-all' }
                            : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                        }}>
                        {row.fail_detail ?? '—'}
                      </td>
                    </tr>
                  )
                })}
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
              {loadingMore ? t('adminErrors.loading') : t('adminErrors.loadMore')}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
