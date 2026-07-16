'use client'

import { useEffect, useState } from 'react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  source: 'dashboard' | 'history'
  t: TFn
}

// 웹 공용 광고 카드 (대시보드 하단·열람기록 탭).
// 무료 사용자에게만 노출 — 호출부에서 {!isPro && <AdCard .../>} 가드 필수.
// 쿠팡 다이나믹 배너(iframe, 캐러셀) — 뷰포트에 따라 728×90/320×100 중 1종만 렌더.
// 제휴 고지(ads.partnerDisclosure)는 라벨과 함께 항상 표시.
// ※ 클릭은 iframe 내부에서 발생 — 자체 /api/ad-click 카운터에는 잡히지 않음(의도된 변경).
//   이메일 쪽 정적 배너·카운터는 이 변경과 무관하게 불변.
// source는 시그니처 유지용(현재 미사용) — 호출부(대시보드·열람기록) 수정 불필요.
export default function AdCard({ source: _source, t }: Props) {
  // SSR 안전: 초기값 false, 마운트 후 뷰포트 폭으로 판정.
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < 768)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <div style={{ textAlign: 'center' }}>
      {/* 라벨 + 고지 한 줄 (배너 위, 작게) */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
        {t('ads.label')} · {t('ads.partnerDisclosure')}
      </div>
      {/* 다이나믹 배너 — 뷰포트에 따라 1종만 렌더 */}
      {isNarrow ? (
        <iframe
          src="https://ads-partners.coupang.com/widgets.html?id=1007487&template=carousel&trackingCode=AF5185528&subId=&width=320&height=100&tsource="
          width="320"
          height="100"
          frameBorder="0"
          scrolling="no"
          referrerPolicy="unsafe-url"
          style={{ maxWidth: '100%', display: 'inline-block' }}
        />
      ) : (
        <iframe
          src="https://ads-partners.coupang.com/widgets.html?id=1007486&template=carousel&trackingCode=AF5185528&subId=&width=728&height=90&tsource="
          width="728"
          height="90"
          frameBorder="0"
          scrolling="no"
          referrerPolicy="unsafe-url"
          style={{ maxWidth: '100%', display: 'inline-block' }}
        />
      )}
    </div>
  )
}
