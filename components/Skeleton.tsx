// 공용 스켈레톤 — 라우트 전환(loading.tsx)과 클라이언트 데이터 로딩 구간에서 공용으로 쓴다.
// 색은 CSS 변수만 사용(라이트/다크 양쪽 대응), 애니메이션은 opacity keyframes 하나뿐.
// <style href precedence>는 React가 head로 올려 중복을 제거하므로 여러 번 렌더해도 규칙은 1개다.

const KEYFRAMES = '@keyframes dd-skeleton{0%,100%{opacity:1}50%{opacity:.55}}'

const skeletonBase: React.CSSProperties = {
  background: 'var(--bg-subtle)',
  animation: 'dd-skeleton 1.4s ease-in-out infinite',
}

export function SkeletonBlock({
  height,
  width = '100%',
  radius = 8,
}: {
  height: number
  width?: number | string
  radius?: number
}) {
  return (
    <>
      <style href="dd-skeleton" precedence="default">{KEYFRAMES}</style>
      <div style={{ ...skeletonBase, height, width, borderRadius: radius, flexShrink: 0 }} />
    </>
  )
}

// 카드 한 장 자리 — 제목 줄 1개 + 본문 줄 3개.
export function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '0.5px solid var(--border)',
      borderRadius: 10,
      padding: 16,
      display: 'flex', flexDirection: 'column', gap: 9,
    }}>
      <SkeletonBlock height={14} width="38%" />
      <SkeletonBlock height={12} width="76%" />
      <SkeletonBlock height={12} width="62%" />
    </div>
  )
}

export function SkeletonList({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  )
}
