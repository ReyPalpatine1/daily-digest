'use client'

import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'

// 공통 업그레이드 버튼 — 대시보드 proUpgradeBtn 과 동일한 검정 그라데이션 스타일.
// 기본 동작은 /pricing 이동, label/onClick/style 로 커스텀 가능.
export function UpgradeButton({
  label,
  onClick,
  style,
}: {
  label?: string
  onClick?: () => void
  style?: React.CSSProperties
}) {
  const router = useRouter()
  const { t } = useTranslation()

  const proUpgradeBtn: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 7,
    background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }

  return (
    <button
      onClick={onClick ?? (() => router.push('/pricing'))}
      style={{ ...proUpgradeBtn, ...style }}>
      {label ?? t('nav.proUpgrade')}
    </button>
  )
}

export default UpgradeButton
