'use client'

import { useRouter } from 'next/navigation'

// 법률 문서 공통 렌더 컴포넌트.
// content 는 lib/legal/content.ts 의 마크다운형 문자열(줄바꿈 기준 문단).
// 흑백 톤, CSS 변수만 사용. AppHeader 없이 단순 문서 레이아웃.
export default function LegalPage({ title, content }: { title: string; content: string }) {
  const router = useRouter()

  // 줄바꿈(빈 줄 포함) 기준으로 문단 분리 후, 빈 문단 제거.
  const blocks = content.split('\n').map(l => l.trim()).filter(Boolean)

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 80px',
      }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
            padding: '4px 0',
            fontFamily: 'inherit',
            marginBottom: 20,
          }}>
          ← 대시보드로 돌아가기
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, letterSpacing: -0.3 }}>
          {title}
        </h1>

        <div style={{ fontSize: 14.5, lineHeight: 1.7 }}>
          {blocks.map((block, i) => {
            // 시행일 표기: 작은 회색.
            if (block.startsWith('시행일:')) {
              return (
                <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  {block}
                </p>
              )
            }

            // 부칙: "부칙:" 부분을 굵게.
            if (block.startsWith('부칙')) {
              const idx = block.indexOf(':')
              const head = idx >= 0 ? block.slice(0, idx + 1) : block
              const rest = idx >= 0 ? block.slice(idx + 1) : ''
              return (
                <p key={i} style={{ marginTop: 24, marginBottom: 8 }}>
                  <strong style={{ fontWeight: 700 }}>{head}</strong>{rest}
                </p>
              )
            }

            // "제N조(제목) 본문..." — 앞의 "제N조(제목)"만 굵게.
            const m = block.match(/^(제\d+조\([^)]*\))\s*([\s\S]*)$/)
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
