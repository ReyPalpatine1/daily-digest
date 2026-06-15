'use client'

import { useRouter } from 'next/navigation'

export default function TermsPage() {
  const router = useRouter()

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>이용약관</h1>
      <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 28 }}>
        이용약관 준비 중입니다
      </p>
      <button
        onClick={() => router.push('/dashboard')}
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
        ← 대시보드로 돌아가기
      </button>
    </div>
  )
}
