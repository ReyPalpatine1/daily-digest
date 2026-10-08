'use client'

// 환불 확인 모달.
//
// window.confirm/alert을 쓰지 않는 이유: 브라우저 기본창은 도메인 머리말이 붙고,
// 결제일·금액 같은 구체적인 정보를 함께 보여줄 수 없다. 환불은 되돌릴 수 없는
// 조작이라 무엇이 어떻게 되는지가 창 안에 다 있어야 한다.
//
// 틀·버튼은 공용 ConfirmModal을 쓴다(모든 확인창 공통 규칙).
// 로그인 사용자용 모달이라 문구는 t()로 낸다.
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import ConfirmModal, { ModalText } from '@/components/ConfirmModal'

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

  if (!eligible) {
    // 자격 없음 — 사유만 알린다. 진행할 수 없는 창에 실행 버튼을 두지 않는다.
    // 자동 환불이 막혔다고 해서 길이 끊기면 안 된다 — 문의 창구와 환불정책으로
    // 이 화면에서 바로 닿게 둔다(전자상거래법 제21조 제1항 제1호).
    return (
      <ConfirmModal
        title={t('profile.refundModalTitle')}
        cancelLabel={t('common.close')}
        onCancel={onClose}
        busy={busy}
        links={[
          { label: t('feedback.title'), onClick: () => { onClose(); router.push('/feedback') } },
          { label: t('settings.refund'), href: '/refund' },
        ]}>
        <ModalText>{t(deniedKey)}</ModalText>
      </ConfirmModal>
    )
  }

  return (
    <ConfirmModal
      title={t('profile.refundConfirmQ')}
      cancelLabel={t('profile.refundCancel')}
      confirmLabel={t('profile.refundBtn')}
      onConfirm={onConfirm}
      onCancel={onClose}
      busy={busy}>
      {/* 어느 결제를 무르는지 — 금액이 이 창에서 가장 중요한 숫자라 날짜와 크기를 나눈다. */}
      {paidAt && typeof amount === 'number' && (
        <div style={{
          background: 'var(--bg-subtle)', border: '0.5px solid var(--border)', borderRadius: 8,
          padding: '12px 14px', marginBottom: 12,
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
      <ModalText>{isAutoRenew ? t('profile.refundConfirmAuto') : t('profile.refundConfirm')}</ModalText>
    </ConfirmModal>
  )
}
