// 라우트 전환 중 뼈대 화면 — 프로필 페이지 골격(항목 리스트).

const block = (style: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-subtle)',
  borderRadius: 8,
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
  ...style,
})

export default function ProfileLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <style>{'@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.6}}'}</style>

      <div style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
      }}>
        <div style={block({ width: 150, height: 20 })} />
      </div>

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 56px' }}>
        <div style={block({ width: '40%', height: 22, marginBottom: 20 })} />
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
              <div style={block({ width: 100, height: 13 })} />
              <div style={block({ width: 130, height: 13 })} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
