import LegalPage from '@/components/LegalPage'

// 중국어 전용 주소(/terms/en 과 같은 방식). 서버 컴포넌트로 두어야 본문이
// 빌드 시 정적 HTML 로 그려진다 — 검사기가 JS 를 실행하지 않기 때문.
export default function TermsZhPage() {
  return <LegalPage doc="terms" fixedLang="zh" />
}
