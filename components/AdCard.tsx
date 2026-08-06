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
    <div style={{
      // 열람 기록 항목 카드와 동일한 상자 (목록 리듬 유지).
      // hover 테두리 변화는 넣지 않는다 — 카드 전체가 클릭 대상이 아니므로
      // 클릭 가능한 것처럼 보이면 안 된다. 미읽음 좌측 굵은 테두리도 적용 대상 아님.
      background: 'var(--bg-card)',
      border: '0.5px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      // 배너 높이(90~100)에 비해 카드가 크지 않으므로 여백을 좁게.
      // 고지 문구가 배너 아래로 내려가 하단만 조금 더 좁다(위 12 / 좌우 14 / 아래 10).
      padding: '12px 14px 10px',
      // 본문 maxWidth가 1280이라 목록 카드는 1200px까지 늘어나는데 배너는 728px 고정 —
      // 그대로 두면 좌우가 크게 빈다. 900으로 묶어 좌우 여백을 배너 기준 85px 남짓으로.
      // 모바일(320 배너)에서는 이 maxWidth가 걸리지 않는다.
      maxWidth: 900,
      margin: '0 auto',
      boxSizing: 'border-box',
      // 배너는 고정 폭이라 좌측 정렬하면 우측이 비므로 가운데 정렬 유지.
      textAlign: 'center',
    }}>
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
      {/* 라벨 + 고지 한 줄 (배너 아래, 작게).
          fontSize 11 / text-muted / lineHeight 1.6 은 낮추지 말 것 — 공정위 추천·보증
          심사지침상 경제적 이해관계 고지는 소비자가 쉽게 인식할 수 있어야 하는데,
          위치가 배너 아래라 인식성이 이미 다소 떨어진다. 문구도 확정형 그대로 유지. */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
        {t('ads.label')} · {t('ads.partnerDisclosure')}
      </div>
    </div>
  )
}
