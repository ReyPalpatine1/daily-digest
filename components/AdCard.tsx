'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  source: 'dashboard' | 'history'
  t: TFn
  // 닫기 버튼 핸들러. 숨김 상태는 호출부(대시보드) 한 곳에서 관리한다 —
  // 한 자리를 닫으면 모든 자리의 광고가 함께 사라져야 하기 때문.
  onClose?: () => void
}

// 웹 공용 광고 카드 (대시보드 하단·열람기록 탭).
// 무료 사용자에게만 노출 — 호출부에서 {!isPro && <AdCard .../>} 가드 필수.
// 쿠팡 다이나믹 배너(iframe, 캐러셀) — 뷰포트에 따라 728×90/320×100 중 1종만 렌더.
// 제휴 고지(ads.partnerDisclosure)는 라벨과 함께 항상 표시.
// ※ 배경·테두리로 감싸지 않는다 — 쿠팡 배너 자체가 흰 배경 + 테두리를 가진 상자라
//   우리 카드를 덧씌우면 테두리가 이중으로 보인다.
// ※ 클릭은 iframe 내부에서 발생 — 자체 /api/ad-click 카운터에는 잡히지 않음(의도된 변경).
//   이메일 쪽 정적 배너·카운터는 이 변경과 무관하게 불변.
// source는 시그니처 유지용(현재 미사용) — 호출부(대시보드·열람기록) 수정 불필요.
export default function AdCard({ source: _source, t, onClose }: Props) {
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
      {/* 배너 폭에 맞춰 줄어드는 래퍼 — 고지 줄이 배너 좌우 끝에 맞게 정렬되도록 한다. */}
      <div style={{ display: 'inline-block', maxWidth: '100%' }}>
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
        {/* 좌: 라벨 + 고지 / 우: 닫기 (배너 좌우 끝에 맞춤).
            fontSize 11 / text-muted / lineHeight 1.6 은 낮추지 말 것 — 공정위 추천·보증
            심사지침상 경제적 이해관계 고지는 소비자가 쉽게 인식할 수 있어야 하는데,
            위치가 배너 아래라 인식성이 이미 다소 떨어진다. 문구도 확정형 그대로 유지. */}
        <div style={{
          width: '100%', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', gap: 8,
          fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 8,
        }}>
          <span style={{ textAlign: 'left' }}>
            {t('ads.label')} · {t('ads.partnerDisclosure')}
          </span>
          {onClose && (
            <button onClick={onClose}
              aria-label={t('ads.close')}
              style={{
                flexShrink: 0, background: 'transparent', border: 'none',
                padding: 2, cursor: 'pointer', color: 'var(--text-muted)',
                display: 'inline-flex', alignItems: 'center', lineHeight: 0,
              }}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
