'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function Home() {
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) window.location.href = '/dashboard'
    })
  }, [])

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0a', fontFamily: 'sans-serif',
      padding: '20px'
    }}>
      <div style={{ textAlign: 'center', width: '100%', maxWidth: 400 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 'clamp(32px, 8vw, 48px)', color: '#e8ff47', fontWeight: 700, letterSpacing: 3, marginBottom: 8 }}>
          DAILY DIGEST
        </div>
        <div style={{ fontSize: 'clamp(13px, 3vw, 16px)', color: '#666', marginBottom: 'clamp(32px, 8vw, 48px)' }}>
          유튜브 AI 요약 에이전트
        </div>
        <button onClick={loginWithGoogle}
          onTouchEnd={(e) => { e.preventDefault(); loginWithGoogle() }}
          style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: 'clamp(12px, 3vw, 14px) clamp(20px, 5vw, 28px)', borderRadius: 10,
          border: '1px solid #333', background: '#111',
          color: '#f0f0f0', cursor: 'pointer', fontSize: 'clamp(13px, 3.5vw, 15px)',
          margin: '0 auto', transition: 'border-color 0.2s',
          width: '100%', maxWidth: 280
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google 계정으로 로그인
        </button>
        <div style={{ fontSize: 12, color: '#444', marginTop: 24 }}>
          가족 공유용 · 초대받은 분만 사용 가능
        </div>
      </div>
    </div>
  )
}