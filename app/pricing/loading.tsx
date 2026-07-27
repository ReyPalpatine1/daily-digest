// 라우트 전환 중 뼈대 화면 — 요금제 페이지 골격(제목 + 플랜 카드 2개).
import { SkeletonBlock } from '@/components/Skeleton'

export default function PricingLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <div style={{ borderBottom: '0.5px solid var(--border-light)', padding: '14px 20px' }}>
        <SkeletonBlock height={20} width={150} />
      </div>

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 64px' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 32,
        }}>
          <SkeletonBlock height={26} width={220} />
          <SkeletonBlock height={14} width={300} />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {[0, 1].map(i => (
            <div key={i} style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 14,
              padding: 24,
              display: 'flex', flexDirection: 'column', gap: 9,
            }}>
              <SkeletonBlock height={18} width={70} />
              <SkeletonBlock height={30} width={140} />
              <div style={{ height: 8 }} />
              <SkeletonBlock height={12} width="90%" />
              <SkeletonBlock height={12} width="80%" />
              <SkeletonBlock height={12} width="85%" />
              <div style={{ height: 12 }} />
              <SkeletonBlock height={42} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
