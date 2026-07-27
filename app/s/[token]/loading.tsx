// 라우트 전환 중 뼈대 화면 — 공유 페이지 골격(메모 + 요약(tldr·핵심 포인트) + 타임라인).

const block = (style: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-subtle)',
  borderRadius: 8,
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
  ...style,
})

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 14,
  padding: 18,
}

export default function ShareLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <style>{'@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.6}}'}</style>

      <header style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
      }}>
        <div style={block({ width: 150, height: 20 })} />
      </header>

      <main style={{
        maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* 메모 */}
        <div style={{ ...card, background: 'var(--bg-subtle)' }}>
          <div style={block({ width: 110, height: 12, marginBottom: 10 })} />
          <div style={block({ width: '70%', height: 13 })} />
        </div>

        {/* 제목 */}
        <div style={card}>
          <div style={block({ width: '85%', height: 18, marginBottom: 8 })} />
          <div style={block({ width: 100, height: 12 })} />
        </div>

        {/* 요약(tldr) */}
        <div style={card}>
          <div style={block({ width: '92%', height: 14, marginBottom: 8 })} />
          <div style={block({ width: '64%', height: 14 })} />
        </div>

        {/* 핵심 포인트 */}
        <div style={card}>
          <div style={block({ width: 84, height: 12, marginBottom: 12 })} />
          <div style={block({ width: '100%', height: 13, marginBottom: 9 })} />
          <div style={block({ width: '88%', height: 13, marginBottom: 9 })} />
          <div style={block({ width: '94%', height: 13 })} />
        </div>

        {/* 임베드 + 타임라인 */}
        <div style={card}>
          <div style={block({ width: '100%', height: 180, marginBottom: 14 })} />
          <div style={block({ width: 70, height: 12, marginBottom: 12 })} />
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 9 }}>
              <div style={block({ width: 42, height: 12, flexShrink: 0 })} />
              <div style={block({ flex: 1, height: 12 })} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
