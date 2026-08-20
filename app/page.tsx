'use client'

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { captureSignupRef } from '@/lib/signup-ref'

// 전화번호 조각 (스팸 수집기 방어: 완성 문자열을 소스·초기 DOM에 두지 않음)
const PHONE_PARTS = ['010', '8791', '9498'] // ← 배포 시 실제 번호 조각으로 교체

export default function Home() {
  const { t } = useTranslation()
  const [isMobile, setIsMobile] = useState(false)
  const [showPhone, setShowPhone] = useState(false)

  // 공유 페이지 유입 표시(?ref=share&t=...) 보관 — 로그인 리다이렉트보다 먼저 저장한다.
  useEffect(() => {
    captureSignupRef(window.location.search)
  }, [])

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

  const googleSvg = (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )

  const previewItems = [
    { channel: t('landing.item1.channel'), title: t('landing.item1.title'), summary: t('landing.item1.summary') },
    { channel: t('landing.item2.channel'), title: t('landing.item2.title'), summary: t('landing.item2.summary') },
    { channel: t('landing.item3.channel'), title: t('landing.item3.title'), summary: t('landing.item3.summary') },
    { channel: t('landing.item4.channel'), title: t('landing.item4.title'), summary: t('landing.item4.summary') },
  ]

  // 동의 문구 링크 / 푸터 링크 (내부 페이지 → 일반 앵커, 흑백·CSS 변수)
  const consentLinkStyle: React.CSSProperties = { color: 'var(--text-secondary)', textDecoration: 'underline' }
  const footerLinkStyle: React.CSSProperties = { color: 'var(--text-secondary)', textDecoration: 'none' }

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
              color: 'var(--bg-primary)',
              fontSize: 16, fontWeight: 700,
            }}>D</div>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>Daily Video Digest</span>
          </div>
          <button
            onClick={loginWithGoogle}
            onTouchEnd={(e) => { e.preventDefault(); loginWithGoogle() }}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--bg-primary)',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 500,
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {t('landing.loginShort')}
          </button>
        </header>

        {/* 히어로 */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1.1fr',
          gap: 40,
          alignItems: 'center',
          marginTop: isMobile ? 44 : 80,
          paddingBottom: isMobile ? 56 : 88,
        }}>
          {/* 좌측: 카피 + CTA */}
          <div>
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-tertiary)',
              marginBottom: 16,
            }}>
              {t('landing.kicker')}
            </div>
            <h1 style={{
              fontSize: isMobile ? 34 : 44,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-1.8px',
              margin: 0,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
            }}>
              {t('landing.headline')}
            </h1>
            <p style={{
              fontSize: 15,
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              margin: '18px 0 0',
              maxWidth: 320,
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
                  padding: '12px 22px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--bg-primary)',
                  cursor: 'pointer',
                  fontSize: 14.5,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                {googleSvg}
                {t('landing.cta')}
              </button>
              {/* 동의 문구 (로그인 진입 버튼 바로 아래) */}
              <p style={{ maxWidth: 340, margin: '14px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
                {t('landing.consentNotice').split(/(\{terms\}|\{privacy\})/).map((part, i) => {
                  if (part === '{terms}') return <a key={i} href="/terms" style={consentLinkStyle}>{t('settings.terms')}</a>
                  if (part === '{privacy}') return <a key={i} href="/privacy" style={consentLinkStyle}>{t('settings.privacy')}</a>
                  return <span key={i}>{part}</span>
                })}
              </p>
            </div>
          </div>

          {/* 우측: 메일 미리보기 */}
          <div style={{
            position: 'relative',
            height: isMobile ? 460 : 540,
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
                width: 26, height: 26,
                borderRadius: 7,
                background: 'var(--accent)',
                color: 'var(--bg-primary)',
                fontSize: 13, fontWeight: 700,
                flexShrink: 0,
              }}>D</div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Daily Video Digest</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{t('landing.previewMeta')}</span>
              </div>
              <Mail size={16} style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', flexShrink: 0 }} />
            </div>

            {/* 요약 항목 */}
            <div>
              {previewItems.map((item, i) => (
                <div key={i} style={{
                  padding: '15px 18px',
                  borderBottom: i < previewItems.length - 1 ? '0.5px solid var(--border)' : 'none',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 5 }}>
                    {item.channel}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 5 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
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
              height: 80,
              background: 'linear-gradient(to bottom, transparent, var(--bg-primary))',
              pointerEvents: 'none',
            }} />
          </div>
        </section>

        {/* 하단 푸터 (약관 링크 + 저작권) */}
        <footer style={{
          borderTop: '0.5px solid var(--border)',
          padding: '24px 0 32px',
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            <a href="/terms" style={footerLinkStyle}>{t('settings.terms')}</a>
            <span aria-hidden="true">·</span>
            <a href="/privacy" style={footerLinkStyle}>{t('settings.privacy')}</a>
            <span aria-hidden="true">·</span>
            <a href="/refund" style={footerLinkStyle}>{t('settings.refund')}</a>
          </div>
          {/* 사업자 정보 (법정 표기 — 언어 설정과 무관하게 한국어 고정) */}
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.8, textAlign: 'center' }}>
            <div>
              솔로옵스 | 대표: 김해솔 |{' '}
              <a
                href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=3740403551"
                target="_blank"
                rel="noopener noreferrer"
                style={footerLinkStyle}
              >
                사업자등록번호: 374-04-03551
              </a>
            </div>
            <div>통신판매업신고: 제2026-성남수정-0528호 | 호스팅서비스 제공: Cloudflare, Inc.</div>
            <div>주소: 경기도 성남시 중원구 산성대로378번길 3-4, 201호 (금광동)</div>
            <div>
              문의: support@dailyvideodigest.com | 전화:{' '}
              {showPhone ? (
                <span>{PHONE_PARTS.join('-')}</span>
              ) : (
                <button
                  onClick={() => setShowPhone(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                    color: 'var(--text-secondary)',
                  }}
                >
                  [번호 보기]
                </button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>© 2026 Daily Video Digest</div>
        </footer>
      </div>
    </div>
  )
}
