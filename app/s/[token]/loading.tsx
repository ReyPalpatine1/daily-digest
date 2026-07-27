// 라우트 전환 중 뼈대 화면 — 공유 페이지 골격(메모 + 요약(tldr·핵심 포인트) + 타임라인).
import { SkeletonBlock } from '@/components/Skeleton'

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 14,
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
}

export default function ShareLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <header style={{ borderBottom: '0.5px solid var(--border-light)', padding: '14px 20px' }}>
        <SkeletonBlock height={20} width={150} />
      </header>

      <main style={{
        maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* 메모 */}
        <div style={{ ...card, background: 'var(--bg-subtle)' }}>
          <SkeletonBlock height={12} width={110} />
          <SkeletonBlock height={13} width="70%" />
        </div>

        {/* 제목 */}
        <div style={card}>
          <SkeletonBlock height={18} width="85%" />
          <SkeletonBlock height={12} width={100} />
        </div>

        {/* tldr */}
        <div style={card}>
          <SkeletonBlock height={14} width="92%" />
          <SkeletonBlock height={14} width="64%" />
        </div>

        {/* 핵심 포인트 */}
        <div style={card}>
          <SkeletonBlock height={12} width={84} />
          <div style={{ height: 3 }} />
          <SkeletonBlock height={13} />
          <SkeletonBlock height={13} width="88%" />
          <SkeletonBlock height={13} width="94%" />
        </div>

        {/* 임베드 + 타임라인 */}
        <div style={card}>
          <SkeletonBlock height={180} />
          <div style={{ height: 5 }} />
          <SkeletonBlock height={12} width={70} />
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              <SkeletonBlock height={12} width={42} />
              <SkeletonBlock height={12} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
