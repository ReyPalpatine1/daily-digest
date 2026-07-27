// 라우트 전환 중 뼈대 화면 — 구독/결제 페이지 골격(카드 1개).
import { SkeletonBlock } from '@/components/Skeleton'

export default function SubscribeLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <div style={{ borderBottom: '0.5px solid var(--border-light)', padding: '14px 20px' }}>
        <SkeletonBlock height={20} width={150} />
      </div>

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px' }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          display: 'flex', flexDirection: 'column', gap: 9,
        }}>
          <SkeletonBlock height={20} width={120} />
          <div style={{ height: 6 }} />
          <SkeletonBlock height={12} />
          <SkeletonBlock height={12} width="76%" />
          <div style={{ height: 12 }} />
          <SkeletonBlock height={56} />
          <SkeletonBlock height={44} />
        </div>
      </main>
    </div>
  )
}
