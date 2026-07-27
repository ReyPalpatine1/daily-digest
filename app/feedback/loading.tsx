// 라우트 전환 중 뼈대 화면 — 의견 보내기 페이지 골격(제목 + 입력 영역).

const block = (style: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-subtle)',
  borderRadius: 8,
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
  ...style,
})

export default function FeedbackLoading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <style>{'@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.6}}'}</style>

      <div style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
      }}>
        <div style={block({ width: 150, height: 20 })} />
      </div>

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 64px' }}>
        <div style={block({ width: '46%', height: 22, marginBottom: 20 })} />
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 24,
        }}>
          {/* 별점 자리 */}
          <div style={block({ width: 120, height: 13, marginBottom: 10 })} />
          <div style={block({ width: 180, height: 28, marginBottom: 24 })} />
          {/* 유형 선택 자리 */}
          <div style={block({ width: 90, height: 13, marginBottom: 10 })} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <div style={block({ flex: 1, height: 36 })} />
            <div style={block({ flex: 1, height: 36 })} />
            <div style={block({ flex: 1, height: 36 })} />
          </div>
          {/* 내용 입력 자리 */}
          <div style={block({ width: 90, height: 13, marginBottom: 10 })} />
          <div style={block({ width: '100%', height: 140, marginBottom: 20 })} />
          <div style={block({ width: '100%', height: 44 })} />
        </div>
      </main>
    </div>
  )
}
