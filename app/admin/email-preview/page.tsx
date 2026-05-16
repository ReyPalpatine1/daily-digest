'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import {
  buildDigestHtml,
  buildBreakingHtml,
  buildWelcomeHtml,
  buildErrorPreviewHtml,
  dummyDigestItems,
  dummyBreakingItem,
  type EmailLocale,
} from '@/lib/email-templates'

type EmailType = 'digest' | 'breaking' | 'error' | 'welcome'

export default function EmailPreviewPage() {
  const router = useRouter()
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [emailLocale, setEmailLocale] = useState<EmailLocale>('ko')
  const [type, setType] = useState<EmailType>('digest')

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      if (!adminEmails.includes((data.user.email ?? '').toLowerCase())) {
        router.push('/dashboard')
        return
      }
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  const html =
    type === 'digest' ? buildDigestHtml(dummyDigestItems(emailLocale), 'Daily Digest', emailLocale)
      : type === 'breaking' ? buildBreakingHtml(dummyBreakingItem(emailLocale), 'Daily Digest', emailLocale)
        : type === 'welcome' ? buildWelcomeHtml(emailLocale)
          : buildErrorPreviewHtml(emailLocale)

  const ADMIN_BAR_BG = '#0A0A0A'
  const ADMIN_BAR_FG = '#FAFAFA'
  const ADMIN_BAR_SUBTLE = '#1F1F1F'
  const ADMIN_BAR_MUTED = '#71717A'

  const types: { key: EmailType; label: string }[] = [
    { key: 'digest', label: t('nav.history') },
    { key: 'breaking', label: t('history.breakingBadge') },
    { key: 'error', label: t('admin.cronError') },
    { key: 'welcome', label: 'Welcome' },
  ]

  const segBtn = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: active ? 'var(--bg-card)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    fontWeight: active ? 500 : 400, fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)' }}>
      {/* 관리자 상단바 (검정 고정) */}
      <header style={{
        height: 56, background: ADMIN_BAR_BG,
        display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px',
        borderBottom: `0.5px solid ${ADMIN_BAR_SUBTLE}`,
      }}>
        <button onClick={() => router.push('/admin')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: ADMIN_BAR_MUTED, fontSize: 13, fontFamily: 'inherit' }}>
          {t('subscribe.back')}
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: ADMIN_BAR_FG }}>이메일 템플릿 미리보기</span>
        <span style={{
          background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700,
          padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5,
        }}>ADMIN</span>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        {/* 컨트롤 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'inline-flex', background: 'var(--bg-subtle)', borderRadius: 8, padding: 3 }}>
            {(['ko', 'en'] as const).map(l => (
              <button key={l} onClick={() => setEmailLocale(l)} style={segBtn(emailLocale === l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'inline-flex', background: 'var(--bg-subtle)', borderRadius: 8, padding: 3 }}>
            {types.map(ty => (
              <button key={ty.key} onClick={() => setType(ty.key)} style={segBtn(type === ty.key)}>
                {ty.label}
              </button>
            ))}
          </div>
        </div>

        {/* 미리보기 iframe */}
        <div style={{
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          <iframe
            title="email-preview"
            srcDoc={html}
            style={{ width: '100%', height: 720, border: 'none', display: 'block', background: '#FAFAFA' }}
          />
        </div>
      </main>
    </div>
  )
}
