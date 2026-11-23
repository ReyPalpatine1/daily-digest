'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Info, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { isPrivacyNoticeActive } from '@/lib/legal/privacy-versions'

// 개인정보처리방침 개정 공지 배너(대시보드 상단).
// 노출 기간은 lib/legal/privacy-versions.ts(2026-11-24 00:00 ~ 2026-11-30 23:59 KST) — 지나면 자동으로 사라진다.
// 닫은 상태는 localStorage(기기별)로만 관리한다 — 새 DB 컬럼을 만들지 않는다.
// 시각·localStorage 는 마운트 후에만 읽는다(첫 렌더는 숨김 → 하이드레이션 불일치 없음).
const DISMISS_KEY = 'privacy_notice_20261201_dismissed'

export default function PrivacyNoticeBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isPrivacyNoticeActive(Date.now())) return
    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      // 접근 차단 환경에선 닫음 상태를 알 수 없다 — 공지는 보여 준다.
    }
    if (!dismissed) setVisible(true)
  }, [])

  if (!visible) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // 저장 실패해도 이번 렌더에선 닫힌다
    }
    setVisible(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      background: 'var(--bg-card)',
      border: '0.5px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 16,
    }}>
      <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-secondary)' }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
        {t('privacyNotice.message')}{' '}
        <Link href="/privacy"
          style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap' }}>
          {t('privacyNotice.cta')}
        </Link>
      </div>
      <button onClick={dismiss}
        aria-label={t('privacyNotice.close')}
        style={{
          background: 'transparent', border: 'none', padding: 4, margin: -4,
          cursor: 'pointer', color: 'var(--text-muted)',
          display: 'inline-flex', alignItems: 'center', lineHeight: 0, flexShrink: 0,
        }}>
        <X size={14} />
      </button>
    </div>
  )
}
