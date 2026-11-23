import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// 광고 수신거부 링크 페이지 — 회원별 서명 토큰이 붙는 주소라 검색에 노출하지 않는다.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function UnsubscribeLayout({ children }: { children: ReactNode }) {
  return children
}
