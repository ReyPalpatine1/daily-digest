'use client'

import { AppHeader } from '@/components/AppHeader'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { TERMS_KO, TERMS_EN, PRIVACY_KO, PRIVACY_EN, REFUND_KO, REFUND_EN } from '@/lib/legal/content'

// 법률 문서 공통 렌더 컴포넌트.
// 본문은 lib/legal/content.ts 의 마크다운형 문자열(줄바꿈 기준 문단).
// 흑백 톤, CSS 변수만 사용. 상단은 공용 AppHeader(showBack) — 비로그인 접근에도 안전.
export type LegalDoc = 'terms' | 'privacy' | 'refund'
type DocLang = 'ko' | 'en'

// 문서별 언어판. 현재 3종 모두 영어판이 있어 한국어 폴백은 발생하지 않는다.
// (en 이 없는 문서를 추가하면 영어 요청 시 ko 로 떨어진다)
const DOCS: Record<LegalDoc, { ko: { title: string; body: string }; en?: { title: string; body: string } }> = {
  terms: {
    ko: { title: '이용약관', body: TERMS_KO },
    en: { title: 'Terms of Service', body: TERMS_EN },
  },
  privacy: {
    ko: { title: '개인정보처리방침', body: PRIVACY_KO },
    en: { title: 'Privacy Policy', body: PRIVACY_EN },
  },
  refund: {
    ko: { title: '환불 정책', body: REFUND_KO },
    en: { title: 'Refund Policy', body: REFUND_EN },
  },
}

export default function LegalPage({ doc, fixedLang }: { doc: LegalDoc; fixedLang?: DocLang }) {
  const { locale } = useTranslation()
  // 언어 고정(/terms/en 등 영어 전용 주소): 전역 언어와 무관하게 영어로 그린다.
  // 서버 페이지에서 넘어오므로 영어 본문이 빌드 시 정적 HTML 에 들어간다
  // (구글 검증 검사기는 JS 를 실행하지 않는다).
  // 기본 주소: 전역 언어를 따른다. ko 만 한국어, 나머지(en/zh/ja)는 영어판.
  const requested: DocLang = fixedLang ?? (locale === 'ko' ? 'ko' : 'en')
  return <LegalView doc={doc} requested={requested} />
}

function LegalView({ doc, requested }: { doc: LegalDoc; requested: DocLang }) {
  const entry = DOCS[doc]
  // 영어를 골랐어도 영어판이 없으면 한국어 본문·제목을 쓴다.
  const view: DocLang = requested === 'en' && entry.en ? 'en' : 'ko'
  const { title, body } = view === 'en' && entry.en ? entry.en : entry.ko

  // 줄바꿈(빈 줄 포함) 기준으로 문단 분리 후, 빈 문단 제거.
  const blocks = body.split('\n').map(l => l.trim()).filter(Boolean)

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack />

      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 80px',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, letterSpacing: -0.3 }}>
          {title}
        </h1>

        <div style={{ fontSize: 14.5, lineHeight: 1.7 }}>
          {blocks.map((block, i) => {
            // 시행일 표기: 작은 회색.
            if (block.startsWith('시행일:') || block.startsWith('Effective date:')) {
              return (
                <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  {block}
                </p>
              )
            }

            // 부칙 / Addendum: 앞부분을 굵게.
            if (block.startsWith('부칙') || block.startsWith('Addendum')) {
              const idx = block.indexOf(':')
              const head = idx >= 0 ? block.slice(0, idx + 1) : block
              const rest = idx >= 0 ? block.slice(idx + 1) : ''
              return (
                <p key={i} style={{ marginTop: 24, marginBottom: 8 }}>
                  <strong style={{ fontWeight: 700 }}>{head}</strong>{rest}
                </p>
              )
            }

            // "제N조(제목) 본문..." / "Article N (Title) 본문..." — 앞의 조문 제목만 굵게.
            // 영어판에는 "Article 9-2" 처럼 하이픈이 들어간 조문이 있어 [\d-] 로 받는다.
            const m =
              block.match(/^(제\d+조\([^)]*\))\s*([\s\S]*)$/) ||
              block.match(/^(Article\s+[\d-]+\s*\([^)]*\))\s*([\s\S]*)$/)
            if (m) {
              return (
                <p key={i} style={{ marginTop: 20, marginBottom: 8 }}>
                  <strong style={{ fontWeight: 700 }}>{m[1]}</strong>{m[2] ? ' ' + m[2] : ''}
                </p>
              )
            }

            // 그 외(전문 등): 일반 문단.
            return (
              <p key={i} style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
                {block}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}
