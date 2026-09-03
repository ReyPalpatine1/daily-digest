'use client'

import LegalPage from '@/components/LegalPage'

// 제목·본문·언어 선택은 LegalPage 안에서 처리한다(문서 종류만 넘긴다).
export default function RefundPage() {
  return <LegalPage doc="refund" />
}
