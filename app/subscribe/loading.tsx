// 라우트 전환 중 뼈대 화면 — 구독/결제 페이지 골격(카드 1개).

const block = (style: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-subtle)',
  borderRadius: 8,
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
  ...style,
})

export default function SubscribeLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <style>{'@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.6}}'}</style>

      <div style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
      }}>
        <div style={block({ width: 150, height: 20 })} />
      </div>

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px' }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 24,
        }}>
          <div style={block({ width: 120, height: 20, marginBottom: 16 })} />
          <div style={block({ width: '100%', height: 12, marginBottom: 9 })} />
          <div style={block({ width: '76%', height: 12, marginBottom: 24 })} />
          <div style={block({ width: '100%', height: 56, marginBottom: 12 })} />
          <div style={block({ width: '100%', height: 44 })} />
        </div>
      </main>
    </div>
  )
}
