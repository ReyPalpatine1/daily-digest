// 토스 심사용 임시 로그인 화면. 심사 종료 후 이 파일과 Supabase 의 Email provider 를
// 함께 제거할 것. 어디에서도 링크하지 않는다.
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function ReviewLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  // 이미 로그인돼 있으면 대시보드로 (랜딩과 동일한 패턴).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) window.location.href = '/dashboard'
    })
  }, [])

  async function handleLogin() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      // 실패 사유는 노출하지 않고 한 문장으로 통일한다.
      if (signInError) {
        setError('로그인에 실패했습니다.')
        setPending(false)
        return
      }
      router.push('/dashboard')
    } catch {
      setError('로그인에 실패했습니다.')
      setPending(false)
    }
  }

  // 랜딩(app/page.tsx)·대시보드의 기존 토큰 재사용.
  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 7,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 20px', letterSpacing: -0.3 }}>
          로그인
        </h1>

        <form
          onSubmit={e => { e.preventDefault(); handleLogin() }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            placeholder="이메일"
            autoComplete="email"
            style={inputStyle} />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            placeholder="비밀번호"
            autoComplete="current-password"
            style={inputStyle} />

          {error && (
            <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            style={{
              marginTop: 4,
              padding: '11px 22px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--bg-primary)',
              cursor: pending ? 'default' : 'pointer',
              opacity: pending ? 0.6 : 1,
              fontSize: 14.5,
              fontWeight: 600,
              fontFamily: 'inherit',
            }}>
            로그인
          </button>
        </form>
      </div>
    </div>
  )
}
