'use client'

import { useTranslation } from '@/lib/i18n/useTranslation'
import NoticeList from '@/components/NoticeList'

// 공용 확인창: 제목 → 회색 목록 박스(NoticeList) → 버튼.
// 구조·토큰은 프로필의 기존 확인 모달과 같다.
// busy 동안에는 두 버튼이 비활성이고 배경 클릭으로도 닫히지 않는다.
export default function ConfirmModal({
  title, lines, confirmLabel, onConfirm, onCancel, busy = false,
}: {
  title: string
  lines: string[]
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div
      onClick={() => { if (!busy) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400,
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderRadius: 14, padding: 22, boxSizing: 'border-box',
          boxShadow: 'var(--shadow-lg)',
        }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {lines.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <NoticeList lines={lines} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 14px', borderRadius: 8,
              border: '0.5px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
              cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
            }}>
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: 'var(--text-primary)', color: 'var(--bg-card)',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
