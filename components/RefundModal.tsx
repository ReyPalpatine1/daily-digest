'use client'

// 환불 확인 모달.
//
// window.confirm/alert을 쓰지 않는 이유: 브라우저 기본창은 도메인 머리말이 붙고,
// 결제일·금액 같은 구체적인 정보를 함께 보여줄 수 없다. 환불은 되돌릴 수 없는
// 조작이라 무엇이 어떻게 되는지가 창 안에 다 있어야 한다.
//
// 오버레이 구조·z-index는 ReportModal과 동일 규칙(fixed inset 0 / zIndex 200 /
// 배경 클릭 시 닫힘 / lucide X 닫기 버튼). 단 ReportModal은 외부인용 한국어 고정
// 페이지의 모달이라 문구를 직접 쓰지만, 이 모달은 로그인 사용자용이라 t()를 쓴다.
import type { CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/useTranslation'

type Props = {
  eligible: boolean
  // 자격 없음일 때의 사유. checkRefundEligibility의 reason과 같은 값.
  reason?: string | null
  amount?: number | null
  paidAt?: string | null
  isAutoRenew?: boolean
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
}

export default function RefundModal({
  eligible, reason, amount, paidAt, isAutoRenew, onConfirm, onClose, busy,
}: Props) {
  const { t, locale } = useTranslation()
  const router = useRouter()

  const dateLocale =
    locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US'
  // 결제 시각은 KST 기준이다 — 사용자의 기기 타임존을 따르면 결제일이 하루 어긋나 보인다.
  const formatKstDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: 'numeric', day: 'numeric',
    })
  const won = (n: number) => `₩${n.toLocaleString(dateLocale)}`

  // 자격 없음 사유 — 문구는 환불정책과 맞춰 둔 것이라 여기서 새로 만들지 않는다.
  const deniedKey =
    reason === 'expired' ? 'profile.refundDeniedExpired'
      : reason === 'used' ? 'profile.refundDeniedUsed'
        : 'profile.refundDeniedNone'

  const btnBase: CSSProperties = {
    height: 42, borderRadius: 8, fontSize: 14, fontWeight: 600,
    fontFamily: 'inherit', flex: 1,
  }
  const cancelBtn: CSSProperties = {
    ...btnBase, fontWeight: 500,
    border: '0.5px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.5 : 1,
  }
  const confirmBtn: CSSProperties = {
    ...btnBase, border: 'none',
    background: 'var(--text-primary)', color: 'var(--bg-card)',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.5 : 1,
  }
  // 자격 없음 화면의 두 링크 — 문구와 같은 급으로 조용히 두되 눌리는 것으로 읽혀야 한다.
  const linkStyle: CSSProperties = {
    background: 'transparent', border: 'none', padding: 0,
    fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'inherit',
    cursor: 'pointer', textDecoration: 'underline',
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 14,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 420,
          maxHeight: 'calc(100dvh - 28px)', overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          boxSizing: 'border-box',
          boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
        }}>
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('profile.refundModalTitle')}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('profile.refundCancel')}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              cursor: busy ? 'default' : 'pointer',
              color: 'var(--text-tertiary)', fontFamily: 'inherit',
            }}>
            <X size={19} />
          </button>
        </div>

        {eligible ? (
          <>
            {/* 묻는 말이 먼저 온다 — 무엇을 승낙하는 창인지가 맨 위에 있어야 한다.
                굵기·크기·색은 아래 설명문과 같게 둔다. 위계는 제목(16/700)이 지고,
                이 문장은 순서(맨 위)로 읽히게 한다. */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {t('profile.refundConfirmQ')}
            </div>

            {/* 어느 결제를 무르는지 — 금액이 이 창에서 가장 중요한 숫자라 날짜와 크기를 나눈다. */}
            {paidAt && typeof amount === 'number' && (
              <div style={{
                background: 'var(--bg-subtle)', borderRadius: 8,
                padding: '12px 14px', margin: '12px 0 14px',
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {formatKstDate(paidAt)}
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2,
                }}>
                  {won(amount)}
                </div>
              </div>
            )}

            {/* 승낙하면 계정이 어떻게 되는지 — 자동 갱신 해지 여부가 갈린다. */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {isAutoRenew ? t('profile.refundConfirmAuto') : t('profile.refundConfirm')}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button type="button" onClick={onClose} disabled={busy} style={cancelBtn}>
                {t('profile.refundCancel')}
              </button>
              <button type="button" onClick={onConfirm} disabled={busy} style={confirmBtn}>
                {t('profile.refundBtn')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 자격 없음 — 사유만 알린다. 진행할 수 없는 창에 확인 버튼을 두지 않는다. */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {t(deniedKey)}
            </div>

            {/* 자동 환불이 막혔다고 해서 길이 끊기면 안 된다 — 문의 창구와 환불정책으로
                이 화면에서 바로 닿게 둔다(전자상거래법 제21조 제1항 제1호). */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => { onClose(); router.push('/feedback') }}
                style={linkStyle}>
                {t('feedback.title')}
              </button>
              <a
                href="/refund"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...linkStyle, cursor: 'pointer' }}>
                {t('settings.refund')}
              </a>
            </div>

            <div style={{ display: 'flex', marginTop: 20 }}>
              <button type="button" onClick={onClose} style={cancelBtn}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
