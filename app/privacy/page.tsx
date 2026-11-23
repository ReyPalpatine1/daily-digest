import LegalPage from '@/components/LegalPage'

// 제목·본문·언어 선택은 LegalPage 안에서 처리한다(문서 종류만 넘긴다).
// 서버 컴포넌트 — 시행일 전환·개정 공지의 첫 렌더 기준 시각(serverNowMs)을 넘기기 위해서다.
// ?version=2026-07-14 / ?lang= 은 LegalPage 가 마운트 후 읽는다.
export default function PrivacyPage() {
  return <LegalPage doc="privacy" serverNowMs={Date.now()} />
}
