'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AppHeader } from '@/components/AppHeader'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { TERMS_KO, TERMS_EN, PRIVACY_KO, PRIVACY_EN, REFUND_KO, REFUND_EN } from '@/lib/legal/content'

// 법률 문서 공통 렌더 컴포넌트.
// 본문은 lib/legal/content.ts 의 마크다운형 문자열(줄바꿈 기준 문단).
// 흑백 톤, CSS 변수만 사용. 상단은 공용 AppHeader(showBack) — 비로그인 접근에도 안전.
export type LegalDoc = 'terms' | 'privacy' | 'refund'
type DocLang = 'ko' | 'en'

// 문서별 언어판. 현재 3종 모두 영어판이 있어 한국어 폴백은 발생하지 않는다.
// (en 이 없는 문서를 추가하면 English 를 눌러도 ko 로 떨어지고 안내문이 뜬다)
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

export default function LegalPage({ doc }: { doc: LegalDoc }) {
  // useSearchParams 는 Suspense 경계가 없으면 next build 가 실패한다.
  // fallback 을 한국어판으로 두어 정적 프리렌더 HTML에도 본문이 남게 한다(빈 화면 방지).
  return (
    <Suspense fallback={<LegalView doc={doc} requested="ko" />}>
      <LegalPageWithLang doc={doc} />
    </Suspense>
  )
}

// URL 쿼리를 읽어 표시 언어를 정한다. 전역 언어(LocaleProvider)는 건드리지 않는다.
function LegalPageWithLang({ doc }: { doc: LegalDoc }) {
  const params = useSearchParams()
  const { locale } = useTranslation()
  const q = params.get('lang')
  // ?lang= 이 유효하면 최우선. 없거나 알 수 없는 값이면 기존 판정(localStorage → 브라우저 → ko).
  const picked = q === 'ko' || q === 'en' || q === 'zh' || q === 'ja' ? q : locale
  // ko 만 한국어, 나머지(en/zh/ja)는 영어로 본다.
  return <LegalView doc={doc} requested={picked === 'ko' ? 'ko' : 'en'} />
}

function LegalView({ doc, requested }: { doc: LegalDoc; requested: DocLang }) {
  const router = useRouter()
  const pathname = usePathname()

  const entry = DOCS[doc]
  const hasEn = Boolean(entry.en)
  // 영어를 골랐어도 영어판이 없으면 한국어 본문·제목을 쓴다.
  const view: DocLang = requested === 'en' && entry.en ? 'en' : 'ko'
  const { title, body } = view === 'en' && entry.en ? entry.en : entry.ko

  // 줄바꿈(빈 줄 포함) 기준으로 문단 분리 후, 빈 문단 제거.
  const blocks = body.split('\n').map(l => l.trim()).filter(Boolean)

  // 언어 전환은 localStorage 가 아니라 URL 쿼리로 남긴다 — 구글 재심사에 주소를 제출해야 한다.
  const selectLang = (next: DocLang) => {
    router.replace(`${pathname}?lang=${next}`, { scroll: false })
  }

  // 관리자 필터 칩과 같은 톤 (선택된 쪽만 배경/글자를 올린다).
  const langChip = (value: DocLang, label: string) => {
    const active = requested === value
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => selectLang(value)}
        style={{
          padding: '5px 12px', borderRadius: 7, border: 'none',
          background: active ? 'var(--bg-subtle)' : 'transparent',
          color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontSize: 12.5, fontWeight: active ? 600 : 500,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        {label}
      </button>
    )
  }

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
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, letterSpacing: -0.3 }}>
          {title}
        </h1>

        {/* 언어 선택 — 누르면 주소창에 ?lang= 이 붙는다. */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {langChip('ko', '한국어')}
          {langChip('en', 'English')}
        </div>
        {requested === 'en' && !hasEn && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 6px' }}>
            This document is currently available in Korean only.
          </p>
        )}

        <div style={{ fontSize: 14.5, lineHeight: 1.7, marginTop: 12 }}>
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
