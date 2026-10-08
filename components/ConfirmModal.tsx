'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from '@/lib/i18n/useTranslation'

// 공용 확인창 — 모든 확인·알림 모달은 이 틀 하나로 그린다
// (작업창(공유하기·신고 입력 폼·도움말)과 저절로 뜨는 알림창 TrialPopup은 제외).
//
// 구성: [아이콘?] 제목 → children(본문 ModalText·목록 박스 NoticeList·체크박스를 호출부가 조합)
//       → 버튼(오른쪽 정렬: 되돌아가기=흰색 왼쪽, 실행=검정 오른쪽) → 링크 줄(가운데).
// 실행 버튼(confirmLabel·onConfirm)이 없으면 흰색 버튼 하나만 둔다.
// busy 동안에는 두 버튼이 비활성이고 배경 클릭으로도 닫히지 않는다.
type Props = {
  title: string
  icon?: ReactNode
  children?: ReactNode
  cancelLabel?: string
  confirmLabel?: string
  onConfirm?: () => void
  // 실행 버튼만 비활성(예: 탈퇴 동의 체크 전).
  confirmDisabled?: boolean
  onCancel: () => void
  busy?: boolean
  // 버튼 아래 가운데 링크. href는 새 탭으로 연다.
  links?: { label: string; href?: string; onClick?: () => void }[]
}

const btnBase: CSSProperties = {
  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
}

const linkStyle: CSSProperties = {
  background: 'transparent', border: 'none', padding: 0,
  fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'inherit',
  cursor: 'pointer', textDecoration: 'underline',
}

export default function ConfirmModal({
  title, icon, children, cancelLabel, confirmLabel, onConfirm, confirmDisabled = false,
  onCancel, busy = false, links,
}: Props) {
  const { t } = useTranslation()
  const confirmOff = busy || confirmDisabled

  return (
    <div
      onClick={() => { if (!busy) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 400,
          maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto',
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderRadius: 14, padding: 24, boxSizing: 'border-box',
          boxShadow: 'var(--shadow-lg)',
          textAlign: 'left',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {icon}
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            {title}
          </h2>
        </div>

        {children}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: children ? 18 : 0 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              ...btnBase, fontWeight: 500,
              border: '0.5px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              cursor: busy ? 'default' : 'pointer',
            }}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          {confirmLabel && onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmOff}
              style={{
                ...btnBase, fontWeight: 600, border: 'none',
                background: 'var(--text-primary)', color: 'var(--bg-card)',
                cursor: confirmOff ? 'default' : 'pointer',
                opacity: confirmOff ? 0.5 : 1,
              }}>
              {confirmLabel}
            </button>
          )}
        </div>

        {links && links.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            {links.map(link =>
              link.href ? (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={linkStyle}>
                  {link.label}
                </a>
              ) : (
                <button key={link.label} type="button" onClick={link.onClick} style={linkStyle}>
                  {link.label}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// 확인창 본문 문단 — 박스 없는 일반 문장. 여백은 app/globals.css의 .modal-text가 맡는다
// (기본 0, 여러 문단이면 사이 6px — 인라인 margin을 주면 그 규칙을 덮어쓰므로 두지 않는다).
export function ModalText({ children }: { children: ReactNode }) {
  return (
    <p
      className="modal-text"
      style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
      {children}
    </p>
  )
}
