import React from 'react'

// 사용자용 플랜 뱃지 (FREE/PRO, VIP도 PRO로 표시).
// 헤더·대시보드는 size="sm", 프로필은 size="md".
// ⚠️ components/PlanBadge.tsx(관리자용, 4종 단색)와는 별개.
type Props = {
  plan: 'FREE' | 'PRO'
  size?: 'sm' | 'md'
}

const sizeStyle: Record<'sm' | 'md', React.CSSProperties> = {
  sm: { fontSize: 10, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.4 },
  md: { fontSize: 13, padding: '4px 11px', borderRadius: 6, letterSpacing: 0.5 },
}

export default function UserPlanBadge({ plan, size = 'sm' }: Props) {
  const planStyle: React.CSSProperties =
    plan === 'PRO'
      ? {
          background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)',
          color: '#FFFFFF',
          fontWeight: 700,
        }
      : {
          background: 'var(--bg-subtle)',
          color: 'var(--text-tertiary)',
          fontWeight: 600,
        }

  return (
    <span
      style={{
        display: 'inline-block',
        whiteSpace: 'nowrap',
        ...sizeStyle[size],
        ...planStyle,
      }}
    >
      {plan}
    </span>
  )
}
