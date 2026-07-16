'use client'

import { nowUtc, toZoned } from '@/lib/time'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  source: 'dashboard' | 'history'
  t: TFn
}

// 웹 공용 광고 카드 (대시보드 하단·열람기록 탭).
// 무료 사용자에게만 노출 — 호출부에서 {!isPro && <AdCard .../>} 가드 필수.
// 로테이션은 이메일(email-templates.ts)과 동일: KST 일(day)이 짝수면 Pro 배너, 홀수면 제휴.
// 클릭은 /api/ad-click 경유(리다이렉트) — source 별 집계 후 목적지로 302.
export default function AdCard({ source, t }: Props) {
  const kstDay = toZoned(nowUtc()).day
  const slot = kstDay % 2 === 0 ? 'pro_banner' : 'partner'
  const isPartner = slot === 'partner'

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '0.5px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 8 }}>
        {t('ads.label')}
      </div>
      {isPartner && (
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 10 }}>
          {t('ads.partnerDisclosure')}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
            {t(isPartner ? 'ads.partnerTitle' : 'ads.proTitle')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
            {t(isPartner ? 'ads.partnerDesc' : 'ads.proDesc')}
          </div>
        </div>
        <button
          onClick={() => { window.location.href = `/api/ad-click?slot=${slot}&src=${source}` }}
          style={{
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: 'var(--text-primary)', color: 'var(--bg-card)',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          {t(isPartner ? 'ads.partnerCta' : 'ads.proCta')}
        </button>
      </div>
    </div>
  )
}
