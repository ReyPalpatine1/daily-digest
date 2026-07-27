// 라우트 전환 중 뼈대 화면 — 요금제 페이지 골격(제목 + 플랜 카드 2개).

const block = (style: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-subtle)',
  borderRadius: 8,
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
  ...style,
})

export default function PricingLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <style>{'@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.6}}'}</style>

      <div style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
      }}>
        <div style={block({ width: 150, height: 20 })} />
      </div>

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 64px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={block({ width: 220, height: 26, margin: '0 auto 12px' })} />
          <div style={block({ width: 300, height: 14, margin: '0 auto' })} />
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
            }}>
              <div style={block({ width: 70, height: 18, marginBottom: 14 })} />
              <div style={block({ width: 140, height: 30, marginBottom: 20 })} />
              <div style={block({ width: '90%', height: 12, marginBottom: 9 })} />
              <div style={block({ width: '80%', height: 12, marginBottom: 9 })} />
              <div style={block({ width: '85%', height: 12, marginBottom: 24 })} />
              <div style={block({ width: '100%', height: 42 })} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
