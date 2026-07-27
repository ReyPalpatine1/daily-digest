// 라우트 전환 중 뼈대 화면 — 실제 대시보드 골격(헤더 바 + 탭 바 + 카드 3개)과 같은 형태.
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton'

export default function DashboardLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      {/* 헤더 바 */}
      <div style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <SkeletonBlock height={20} width={150} />
        <div style={{ display: 'flex', gap: 8 }}>
          <SkeletonBlock height={28} width={64} />
          <SkeletonBlock height={28} width={32} />
        </div>
      </div>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px' }}>
        {/* 탭 바 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <SkeletonBlock height={32} width={88} />
          <SkeletonBlock height={32} width={88} />
          <SkeletonBlock height={32} width={88} />
        </div>

        <SkeletonList count={3} />
      </main>
    </div>
  )
}
