// 라우트 전환 중 뼈대 화면 — 환불정책 골격(components/LegalPage: 헤더 + 720 컨테이너 + 제목 + 문단).
import { SkeletonBlock } from '@/components/Skeleton'

// 문단처럼 보이도록 줄 길이를 변주한다.
const LINE_WIDTHS = ['100%', '95%', '88%', '97%', '82%', '100%', '91%', '76%', '94%', '85%']

export default function RefundLoading() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{ borderBottom: '0.5px solid var(--border-light)', padding: '14px 20px' }}>
        <SkeletonBlock height={20} width={150} />
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 80px' }}>
        <div style={{ marginBottom: 24 }}>
          <SkeletonBlock height={26} width={180} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {LINE_WIDTHS.map((w, i) => <SkeletonBlock key={i} height={14} width={w} />)}
        </div>
      </div>
    </div>
  )
}
