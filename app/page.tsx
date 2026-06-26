'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'

export default function Home() {
  const { t } = useTranslation()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) window.location.href = '/dashboard'
    })
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
  }

  const googleSvg = (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Navbar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 clamp(16px, 4vw, 40px)',
        height: 56,
        borderBottom: '0.5px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30, height: 30,
            borderRadius: 8,
            background: 'var(--accent)',
            color: 'var(--bg-card)',
            fontSize: 15,
            fontWeight: 700,
            flexShrink: 0,
          }}>D</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Daily Digest
          </span>
        </div>
        <button
          onClick={loginWithGoogle}
          onTouchEnd={(e) => { e.preventDefault(); loginWithGoogle() }}
          style={{
            padding: '6px 14px',
            borderRadius: 7,
            border: '0.5px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {t('auth.landing.loginShort')}
        </button>
      </header>

      {/* Body */}
      <main style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: isMobile ? 0 : 'clamp(24px, 4vw, 48px)',
        alignItems: 'center',
        padding: isMobile
          ? 'clamp(32px, 8vw, 48px) clamp(20px, 6vw, 32px)'
          : 'clamp(40px, 6vw, 72px) clamp(24px, 6vw, 72px)',
        maxWidth: 1100,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {/* Left: copy + CTA */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isMobile ? 'center' : 'flex-start',
          textAlign: isMobile ? 'center' : 'left',
          gap: 0,
          marginBottom: isMobile ? 32 : 0,
        }}>
          <h1 style={{
            fontSize: 'clamp(22px, 4vw, 30px)',
            fontWeight: 500,
            color: 'var(--text-primary)',
            lineHeight: 1.35,
            margin: '0 0 16px',
            letterSpacing: -0.3,
          }}>
            {t('auth.landing.headline')}
          </h1>
          <p style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            margin: '0 0 28px',
            maxWidth: 400,
          }}>
            {t('auth.landing.sub')}
          </p>
          <button
            onClick={loginWithGoogle}
            onTouchEnd={(e) => { e.preventDefault(); loginWithGoogle() }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '11px 22px',
              borderRadius: 10,
              border: '0.5px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              alignSelf: isMobile ? 'center' : 'flex-start',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}
          >
            {googleSvg}
            {t('auth.landing.cta')}
          </button>
          <p style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            margin: '12px 0 0',
          }}>
            {t('auth.landing.caption')}
          </p>
        </div>

        {/* Right: preview panel */}
        <div style={{
          background: 'var(--bg-subtle)',
          borderRadius: 14,
          padding: 'clamp(16px, 3vw, 24px)',
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Preview header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '0.5px solid var(--border)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              letterSpacing: 0.2,
            }}>
              {t('auth.landing.previewLabel')}
            </div>

            {/* Item 1 */}
            <div style={{
              padding: '14px 16px',
              borderBottom: '0.5px solid var(--border-light, var(--border))',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                {t('auth.landing.previewItem1_channel')}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 5 }}>
                {t('auth.landing.previewItem1_title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('auth.landing.previewItem1_summary')}
              </div>
            </div>

            {/* Item 2 */}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                {t('auth.landing.previewItem2_channel')}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 5 }}>
                {t('auth.landing.previewItem2_title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('auth.landing.previewItem2_summary')}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
