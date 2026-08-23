// 공용 회전 진행 표시 — 결제 승인 대기처럼 "몇 초가 확실히 걸리는" 구간에서 쓴다.
// 색은 CSS 변수만 사용(라이트/다크 양쪽 대응), 애니메이션은 회전 keyframes 하나뿐.
// <style href precedence>는 React가 head로 올려 중복을 제거하므로 여러 번 렌더해도 규칙은 1개다
// (components/Skeleton.tsx와 같은 방식).
//
// ※ 목록·카드 자리를 채우는 용도는 Skeleton을 쓸 것. 이건 "기다리는 중"을 알리는 표시다.
import { Loader2 } from 'lucide-react'

const KEYFRAMES = '@keyframes dd-spin{to{transform:rotate(360deg)}}'

export function Spinner({
  size = 30,
  color = 'var(--text-secondary)',
}: {
  size?: number
  color?: string
}) {
  return (
    <>
      <style href="dd-spin" precedence="default">{KEYFRAMES}</style>
      <Loader2
        size={size}
        style={{ color, animation: 'dd-spin 0.9s linear infinite' }}
        aria-hidden
      />
    </>
  )
}

export default Spinner
