'use client'

import { AppHeader } from '@/components/AppHeader'
import { useTranslation } from '@/lib/i18n/useTranslation'
import {
  TERMS_KO, TERMS_EN, PRIVACY_KO, PRIVACY_EN, PRIVACY_JA, PRIVACY_ZH, REFUND_KO, REFUND_EN,
} from '@/lib/legal/content'

// 법률 문서 공통 렌더 컴포넌트.
// 본문은 lib/legal/content.ts 의 마크다운형 문자열(줄바꿈 기준 문단).
// 흑백 톤, CSS 변수만 사용. 상단은 공용 AppHeader(showBack) — 비로그인 접근에도 안전.
export type LegalDoc = 'terms' | 'privacy' | 'refund'
type DocLang = 'ko' | 'en' | 'ja' | 'zh'
type DocEntry = { title: string; body: string }

// 문서별 언어판. ko 는 필수, 나머지는 있는 것만 둔다.
// 요청 언어판이 없으면 영어판으로, 영어판도 없으면 한국어판으로 떨어진다.
// (현재 ja·zh 는 개인정보처리방침에만 있다 — 이용약관·환불정책의 ja·zh 는 영어로 보인다)
const DOCS: Record<LegalDoc, { ko: DocEntry } & Partial<Record<Exclude<DocLang, 'ko'>, DocEntry>>> = {
  terms: {
    ko: { title: '이용약관', body: TERMS_KO },
    en: { title: 'Terms of Service', body: TERMS_EN },
  },
  privacy: {
    ko: { title: '개인정보처리방침', body: PRIVACY_KO },
    en: { title: 'Privacy Policy', body: PRIVACY_EN },
    ja: { title: 'プライバシーポリシー', body: PRIVACY_JA },
    zh: { title: '隐私政策', body: PRIVACY_ZH },
  },
  refund: {
    ko: { title: '환불 정책', body: REFUND_KO },
    en: { title: 'Refund Policy', body: REFUND_EN },
  },
}

export default function LegalPage({ doc, fixedLang }: { doc: LegalDoc; fixedLang?: DocLang }) {
  const { locale } = useTranslation()
  // 언어 고정(/terms/en, /privacy/ja 등 언어 전용 주소): 전역 언어와 무관하게 그 언어로 그린다.
  // 서버 페이지에서 넘어오므로 본문이 빌드 시 정적 HTML 에 들어간다
  // (구글 검증 검사기는 JS 를 실행하지 않는다).
  // 기본 주소: 전역 언어를 따른다. 그 언어판이 없는 문서는 LegalView 에서 영어로 떨어진다.
  const requested: DocLang = fixedLang ?? locale
  return <LegalView doc={doc} requested={requested} />
}

function LegalView({ doc, requested }: { doc: LegalDoc; requested: DocLang }) {
  const entry = DOCS[doc]
  // 요청 언어판 → 영어판 → 한국어판 순으로 쓴다.
  const { title, body } =
    requested === 'ko' ? entry.ko : entry[requested] ?? entry.en ?? entry.ko

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
            if (/^(시행일:|Effective date:|施行日：|生效日期：)/.test(block)) {
              return (
                <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  {block}
                </p>
              )
            }

            // 부칙 / Addendum / 附則 / 附则: 앞부분을 굵게. (일·중은 전각 콜론 '：')
            if (/^(부칙|Addendum|附則|附则)/.test(block)) {
              const idx = block.search(/[:：]/)
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
            // 일·중판은 "第1条（…）" 전각 괄호, 가지 조문은 "第9条の2（" / "第9条之二（".
            // 일·중판은 원문에 공백이 없으므로 제목 뒤에 공백을 넣지 않는다.
            const m =
              block.match(/^(제\d+조\([^)]*\))\s*([\s\S]*)$/) ||
              block.match(/^(Article\s+[\d-]+\s*\([^)]*\))\s*([\s\S]*)$/)
            const cjk = m ? null : block.match(/^(第\d+条(?:の\d+|之[一二三四五六七八九十]+)?（[^）]*）)([\s\S]*)$/)
            if (cjk) {
              return (
                <p key={i} style={{ marginTop: 20, marginBottom: 8 }}>
                  <strong style={{ fontWeight: 700 }}>{cjk[1]}</strong>{cjk[2]}
                </p>
              )
            }
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
