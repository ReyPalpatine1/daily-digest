'use client'

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'

export default function Home() {
  const { t } = useTranslation()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) window.location.href = '/dashboard'
    })
  }, [])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
  }

  const previewItems = [
    { channel: t('landing.item1.channel'), title: t('landing.item1.title'), summary: t('landing.item1.summary') },
    { channel: t('landing.item2.channel'), title: t('landing.item2.title'), summary: t('landing.item2.summary') },
    { channel: t('landing.item3.channel'), title: t('landing.item3.title'), summary: t('landing.item3.summary') },
    { channel: t('landing.item4.channel'), title: t('landing.item4.title'), summary: t('landing.item4.summary') },
  ]

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: isMobile ? '0 20px' : '0 32px',
      }}>
        {/* 상단바 */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
          borderBottom: '0.5px solid var(--border)',
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
              fontSize: 16, fontWeight: 700,
            }}>D</div>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>Daily Digest</span>
          </div>
          <button
            onClick={loginWithGoogle}
            onTouchEnd={(e) => { e.preventDefault(); loginWithGoogle() }}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '0.5px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 500,
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {t('landing.login')}
          </button>
        </header>

        {/* 히어로 */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '0.85fr 1.15fr',
          gap: 44,
          alignItems: 'center',
          marginTop: isMobile ? 48 : 88,
          paddingBottom: isMobile ? 64 : 96,
        }}>
          {/* 좌측: 카피 + CTA */}
          <div>
            <h1 style={{
              fontSize: isMobile ? 28 : 34,
              fontWeight: 500,
              lineHeight: 1.25,
              letterSpacing: -0.6,
              margin: 0,
              color: 'var(--text-primary)',
            }}>
              {t('landing.headline')}
            </h1>
            <p style={{
              fontSize: 15,
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              margin: '16px 0 0',
              maxWidth: 420,
            }}>
              {t('landing.sub')}
            </p>
            <div style={{ marginTop: 32 }}>
              <button
                onClick={loginWithGoogle}
                onTouchEnd={(e) => { e.preventDefault(); loginWithGoogle() }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 20px',
                  borderRadius: 10,
                  border: '0.5px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {t('landing.cta')}
              </button>
            </div>
          </div>

          {/* 우측: 메일 미리보기 */}
          <div style={{
            position: 'relative',
            height: 440,
            borderRadius: 'var(--radius-lg)',
            border: '0.5px solid var(--border)',
            background: 'var(--bg-subtle)',
            overflow: 'hidden',
          }}>
            {/* 메일 헤더 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 18px',
              background: 'var(--bg-card)',
              borderBottom: '0.5px solid var(--border)',
            }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24, height: 24,
                borderRadius: 6,
                background: 'var(--accent)',
                color: 'var(--bg-card)',
                fontSize: 12, fontWeight: 700,
                flexShrink: 0,
              }}>D</div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Daily Digest</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{t('landing.previewMeta')}</span>
              </div>
              <Mail size={16} style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', flexShrink: 0 }} />
            </div>

            {/* 요약 항목 */}
            <div>
              {previewItems.map((item, i) => (
                <div key={i} style={{
                  padding: '14px 18px',
                  borderBottom: i < previewItems.length - 1 ? '0.5px solid var(--border)' : 'none',
                }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    {item.channel}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {item.summary}
                  </div>
                </div>
              ))}
            </div>

            {/* 하단 페이드 */}
            <div style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 72,
              background: 'linear-gradient(to bottom, transparent, var(--bg-primary))',
              pointerEvents: 'none',
            }} />
          </div>
        </section>
      </div>
    </div>
  )
}
