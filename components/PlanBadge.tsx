// 관리자 페이지 전용 진한 플랜 뱃지 (검정 배경에서 사용)
// ⚠️ 일반 사용자 화면 뱃지에는 사용하지 말 것 (사용자 화면은 VIP도 PRO로 표시)
import React from 'react'

export type PlanBadgeKind = 'FREE' | 'PRO' | 'VIP' | 'ADMIN'

// 관리자 이메일 + plan 으로 표시할 뱃지 종류 판정.
// ADMIN_EMAILS 포함 계정은 plan 과 무관하게 ADMIN.
export function getPlanBadge(email: string | null | undefined, plan: string | null | undefined): PlanBadgeKind {
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  if (email && adminEmails.includes(email.toLowerCase())) return 'ADMIN'
  if (plan === 'vip') return 'VIP'
  if (plan === 'pro') return 'PRO'
  return 'FREE'
}

const COLORS: Record<PlanBadgeKind, { bg: string; fg: string }> = {
  FREE:  { bg: '#52525B', fg: '#FFFFFF' },
  PRO:   { bg: '#1D4ED8', fg: '#FFFFFF' },
  VIP:   { bg: '#6D28D9', fg: '#FFFFFF' },
  ADMIN: { bg: '#B91C1C', fg: '#FFFFFF' },
}

export function PlanBadge({ plan, size = 'md' }: { plan: PlanBadgeKind; size?: 'sm' | 'md' }) {
  const c = COLORS[plan]
  const sizeStyle: React.CSSProperties = size === 'sm'
    ? { fontSize: 10, padding: '2px 8px', borderRadius: 5 }
    : { fontSize: 11, padding: '4px 11px', borderRadius: 6 }

  return (
    <span style={{
      ...sizeStyle,
      background: c.bg,
      color: c.fg,
      fontWeight: 700,
      letterSpacing: 0.4,
      display: 'inline-block',
      whiteSpace: 'nowrap',
      lineHeight: 1.4,
    }}>
      {plan}
    </span>
  )
}
