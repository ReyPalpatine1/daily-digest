'use client'

// 공유 페이지 푸터의 '문제 신고' 트리거 — 모달 상태만 갖는 얇은 클라이언트 래퍼.
// 공유 페이지(/s/[token])는 서버 컴포넌트라 상태를 가질 수 없으므로 이 컴포넌트로 감싼다(ShareVideo와 같은 방식).
// 겉모양은 기존 mailto 링크와 동일하게 유지한다(fontSize 10.5 / text-muted / 밑줄).
import { useState } from 'react'
import ReportModal from './ReportModal'

export default function ShareReportButton({ token }: { token: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          fontSize: 10.5, color: 'var(--text-muted)', textDecoration: 'underline',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        문제 신고
      </button>
      {open && <ReportModal token={token} onClose={() => setOpen(false)} />}
    </>
  )
}
