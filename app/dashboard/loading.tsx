// 라우트 전환 중 뼈대 화면 — 실제 대시보드 골격(헤더 바 + 탭 바 + 카드 3개)과 같은 형태.
// 색은 CSS 변수만 사용해 라이트/다크 양쪽 대응. 애니메이션은 opacity keyframes 1개로 제한.

const block = (style: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-subtle)',
  borderRadius: 8,
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
  ...style,
})

export default function DashboardLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <style>{'@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.6}}'}</style>

      {/* 헤더 바 */}
      <div style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={block({ width: 150, height: 20 })} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={block({ width: 64, height: 28 })} />
          <div style={block({ width: 32, height: 28 })} />
        </div>
      </div>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px' }}>
        {/* 탭 바 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <div style={block({ width: 88, height: 32 })} />
          <div style={block({ width: 88, height: 32 })} />
          <div style={block({ width: 88, height: 32 })} />
        </div>

        {/* 카드 3개 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              padding: 16,
            }}>
              <div style={block({ width: '38%', height: 14, marginBottom: 10 })} />
              <div style={block({ width: '72%', height: 12, marginBottom: 8 })} />
              <div style={block({ width: '55%', height: 12 })} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
