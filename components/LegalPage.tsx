'use client'

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { useTranslation } from '@/lib/i18n/useTranslation'
import {
  TERMS_KO, TERMS_EN, TERMS_JA, TERMS_ZH,
  PRIVACY_KO, PRIVACY_EN, PRIVACY_JA, PRIVACY_ZH,
  REFUND_KO, REFUND_EN, REFUND_JA, REFUND_ZH,
} from '@/lib/legal/content'
import {
  PRIVACY_BODIES, PRIVACY_NOTICE, PRIVACY_LINK_LABELS,
  PRIVACY_PREVIOUS_VERSION, PRIVACY_AMENDED_VERSION,
  defaultPrivacyVersion, isPrivacyAmendmentEffective, isPrivacyNoticeActive, parsePrivacyVersion,
  type PrivacyVersion,
} from '@/lib/legal/privacy-versions'

// 법률 문서 공통 렌더 컴포넌트.
// 본문은 lib/legal/content.ts 의 마크다운형 문자열(줄바꿈 기준 문단).
// 흑백 톤, CSS 변수만 사용. 상단은 공용 AppHeader(showBack) — 비로그인 접근에도 안전.
export type LegalDoc = 'terms' | 'privacy' | 'refund'
type DocLang = 'ko' | 'en' | 'ja' | 'zh'
type DocEntry = { title: string; body: string }

// 문서별 언어판. 3종 모두 4개 언어(ko·en·ja·zh)가 있어야 한다 — 타입으로 강제해
// 언어판이 빠지면 빌드가 실패한다(폴백 없음).
const DOCS: Record<LegalDoc, Record<DocLang, DocEntry>> = {
  terms: {
    ko: { title: '이용약관', body: TERMS_KO },
    en: { title: 'Terms of Service', body: TERMS_EN },
    ja: { title: '利用規約', body: TERMS_JA },
    zh: { title: '服务条款', body: TERMS_ZH },
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
    ja: { title: '返金ポリシー', body: REFUND_JA },
    zh: { title: '退款政策', body: REFUND_ZH },
  },
}

const DOC_LANGS: readonly DocLang[] = ['ko', 'en', 'ja', 'zh']

// serverNowMs: 개인정보처리방침의 시행일 전환·개정 공지 판정에 쓰는 "서버가 그린 시각".
//   서버 페이지(app/privacy/**/page.tsx)가 렌더 시점의 Date.now()를 넘긴다. 첫 렌더(정적 HTML·하이드레이션)는
//   이 값으로 그려 서버/클라이언트가 어긋나지 않게 하고, 마운트 후 실제 현재 시각으로 다시 판정한다
//   (정적 HTML이 빌드 시각에 고정돼 있어도 브라우저에서는 시행일이 지나면 바로 바뀐다).
export default function LegalPage({ doc, fixedLang, serverNowMs }: {
  doc: LegalDoc
  fixedLang?: DocLang
  serverNowMs?: number
}) {
  const { locale } = useTranslation()
  const [nowMs, setNowMs] = useState<number>(serverNowMs ?? 0)
  // ?version=·?lang= — 정적 HTML 을 유지하려고 useSearchParams 대신 마운트 후 location 에서 읽는다
  // (useSearchParams 는 이 페이지를 정적 생성에서 빼 버려 언어 전용 주소의 본문이 HTML 에서 사라진다).
  const [queryVersion, setQueryVersion] = useState<PrivacyVersion | null>(null)
  const [queryLang, setQueryLang] = useState<DocLang | null>(null)

  useEffect(() => {
    if (doc !== 'privacy') return
    setNowMs(Date.now())
    try {
      const params = new URLSearchParams(window.location.search)
      setQueryVersion(parsePrivacyVersion(params.get('version')))
      const lang = params.get('lang')
      if (lang && (DOC_LANGS as readonly string[]).includes(lang)) setQueryLang(lang as DocLang)
    } catch {
      // 읽지 못하면 기본 버전·언어로 그린다.
    }
  }, [doc])

  // 언어 고정(/terms/en, /privacy/ja 등 언어 전용 주소): 전역 언어와 무관하게 그 언어로 그린다.
  // 서버 페이지에서 넘어오므로 본문이 빌드 시 정적 HTML 에 들어간다
  // (구글 검증 검사기는 JS 를 실행하지 않는다).
  // 기본 주소: ?lang= 이 있으면 그 언어, 없으면 전역 언어를 따른다.
  const requested: DocLang = fixedLang ?? queryLang ?? locale

  if (doc !== 'privacy') return <LegalView doc={doc} requested={requested} />

  // 개인정보처리방침: ?version= 이 있으면 그 판, 없으면 시행일 기준 기본 판.
  const version = queryVersion ?? defaultPrivacyVersion(nowMs)
  const effective = isPrivacyAmendmentEffective(nowMs)
  const links: { href: string; label: string }[] = []
  const labels = PRIVACY_LINK_LABELS[requested]
  // 개정 전 방침 링크는 상시 노출.
  links.push({ href: `/privacy?version=${PRIVACY_PREVIOUS_VERSION}&lang=${requested}`, label: labels.previous })
  // 시행일 전에는 개정 방침 미리 보기 링크도 노출.
  if (!effective) {
    links.push({ href: `/privacy?version=${PRIVACY_AMENDED_VERSION}&lang=${requested}`, label: labels.preview })
  }

  return (
    <LegalView
      doc={doc}
      requested={requested}
      bodyOverride={PRIVACY_BODIES[version][requested]}
      notice={isPrivacyNoticeActive(nowMs) ? PRIVACY_NOTICE[requested] : null}
      links={links}
    />
  )
}

function LegalView({ doc, requested, bodyOverride, notice, links }: {
  doc: LegalDoc
  requested: DocLang
  bodyOverride?: string
  notice?: string | null
  links?: { href: string; label: string }[]
}) {
  const { title } = DOCS[doc][requested]
  const body = bodyOverride ?? DOCS[doc][requested].body

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

        {/* 개정 안내 — 카드 톤(bg-card + 0.5px border), 아이콘은 lucide. */}
        {notice && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 20,
            fontSize: 13.5, lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}>
            <Info size={16} style={{ flexShrink: 0, marginTop: 3, color: 'var(--text-secondary)' }} />
            <span>{notice}</span>
          </div>
        )}

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

        {/* 버전 링크(개인정보처리방침만) — 같은 경로의 쿼리만 바뀌므로 전체 이동(<a>)으로 다시 읽게 한다. */}
        {links && links.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 16, fontSize: 13.5 }}>
            {links.map(l => (
              <a key={l.href} href={l.href}
                style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
