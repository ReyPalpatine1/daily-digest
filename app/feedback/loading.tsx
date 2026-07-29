// 라우트 전환 중 뼈대 화면 — 의견 보내기 페이지 골격(제목 + 입력 영역).
import { SkeletonBlock } from '@/components/Skeleton'

export default function FeedbackLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <div style={{ borderBottom: '0.5px solid var(--border-light)', padding: '14px 20px' }}>
        <SkeletonBlock height={20} width={150} />
      </div>

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 64px' }}>
        <div style={{ marginBottom: 20 }}>
          <SkeletonBlock height={22} width="46%" />
        </div>
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <SkeletonBlock height={13} width={120} />
          <SkeletonBlock height={28} width={180} />
          <div style={{ height: 12 }} />
          <SkeletonBlock height={13} width={90} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <SkeletonBlock height={40} />
            <SkeletonBlock height={40} />
            <SkeletonBlock height={40} />
          </div>
          <div style={{ height: 12 }} />
          <SkeletonBlock height={13} width={90} />
          <SkeletonBlock height={140} />
          <SkeletonBlock height={44} />
        </div>
      </main>
    </div>
  )
}
