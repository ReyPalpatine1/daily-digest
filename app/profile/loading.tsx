// 라우트 전환 중 뼈대 화면 — 프로필 페이지 골격(항목 리스트).
import { SkeletonBlock } from '@/components/Skeleton'

export default function ProfileLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <div style={{ borderBottom: '0.5px solid var(--border-light)', padding: '14px 20px' }}>
        <SkeletonBlock height={20} width={150} />
      </div>

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 56px' }}>
        <div style={{ marginBottom: 20 }}>
          <SkeletonBlock height={22} width="40%" />
        </div>
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 8,
        }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '14px 16px',
              borderBottom: i < 4 ? '0.5px solid var(--border-light)' : 'none',
            }}>
              <SkeletonBlock height={13} width={100} />
              <SkeletonBlock height={13} width={130} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
