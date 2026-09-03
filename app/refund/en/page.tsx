import LegalPage from '@/components/LegalPage'

// 영어 전용 주소(구글 검증 제출용). 서버 컴포넌트로 두어야 영어 본문이
// 빌드 시 정적 HTML 로 그려진다 — 검사기가 JS 를 실행하지 않기 때문.
export default function RefundEnPage() {
  return <LegalPage doc="refund" fixedLang="en" />
}
