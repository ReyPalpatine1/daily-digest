'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AdminHeader } from '@/components/AdminHeader'
import {
  buildDigestHtml,
  buildBreakingHtml,
  buildWelcomeHtml,
  buildErrorPreviewHtml,
  buildTrialEndingHtml,
  buildTrialEndedHtml,
  buildPassEndingHtml,
  buildPassEndedHtml,
  buildRenewFailedHtml,
  buildSubEndedHtml,
  dummyDigestItems,
  dummyBreakingItem,
  type EmailLocale,
} from '@/lib/email-templates'
import { nowUtc, dateKey } from '@/lib/time'

type EmailType =
  | 'digest' | 'breaking' | 'error' | 'welcome'
  | 'trialEnding' | 'trialEnded' | 'passEnding' | 'passEnded'
  | 'renewFailed' | 'subEnded'

export default function EmailPreviewPage() {
  const router = useRouter()
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [emailLocale, setEmailLocale] = useState<EmailLocale>('ko')
  const [type, setType] = useState<EmailType>('digest')
  // 광고는 무료 사용자에게만 붙는다 — 실제 발송물과 같게 보려면 플랜을 골라야 한다.
  const [plan, setPlan] = useState<'free' | 'pro'>('free')
  // 푸터의 수신 주소 줄은 email 인자가 있을 때만 렌더된다 → 로그인한 관리자 주소를 넘긴다.
  const [adminEmail, setAdminEmail] = useState<string | undefined>(undefined)

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
      setAdminEmail(data.user.email ?? undefined)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  // 종료 예고 메일의 더미 종료일 — 실제 발송(lib/trial-notify.ts)과 같은 KST 'YYYY-MM-DD' 포맷.
  // 날짜를 문자열로 박아두면 시간이 지나며 과거 날짜가 되므로 현재 시각 기준으로 계산한다.
  const dummyEndDate = dateKey(new Date(nowUtc().getTime() + 3 * 24 * 60 * 60 * 1000))

  const html = ((): string => {
    switch (type) {
      case 'digest':
        return buildDigestHtml(dummyDigestItems(emailLocale, plan === 'pro' ? 'pro' : 'free'), 'Daily Video Digest', emailLocale, adminEmail, plan === 'pro')
      case 'breaking':
        return buildBreakingHtml(dummyBreakingItem(emailLocale), 'Daily Video Digest', emailLocale, adminEmail)
      case 'welcome':
        return buildWelcomeHtml(emailLocale)
      case 'trialEnding':
        return buildTrialEndingHtml(emailLocale, dummyEndDate)
      case 'trialEnded':
        return buildTrialEndedHtml(emailLocale)
      case 'passEnding':
        return buildPassEndingHtml(emailLocale, dummyEndDate)
      case 'passEnded':
        return buildPassEndedHtml(emailLocale)
      case 'renewFailed':
        return buildRenewFailedHtml(emailLocale)
      case 'subEnded':
        return buildSubEndedHtml(emailLocale)
      case 'error':
        return buildErrorPreviewHtml(emailLocale)
    }
  })()

  // 라벨: 뒤 6종은 뜻이 맞는 i18n 키가 없어(기존 키는 필드명·안내문 용도) 관리자 전용 화면 기준 한국어 고정.
  const types: { key: EmailType; label: string }[] = [
    { key: 'digest', label: t('nav.history') },
    { key: 'breaking', label: t('history.breakingBadge') },
    { key: 'error', label: t('admin.cronError') },
    { key: 'welcome', label: 'Welcome' },
    { key: 'trialEnding', label: '체험 종료 예정' },
    { key: 'trialEnded', label: '체험 종료' },
    { key: 'passEnding', label: '1개월권 만료 예정' },
    { key: 'passEnded', label: '1개월권 만료' },
    { key: 'renewFailed', label: '갱신 결제 실패' },
    { key: 'subEnded', label: '구독 종료' },
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
      <AdminHeader activeKey="email" />

      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        {/* 컨트롤 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'inline-flex', background: 'var(--bg-subtle)', borderRadius: 8, padding: 3 }}>
            {(['ko', 'en', 'zh', 'ja'] as const).map(l => (
              <button key={l} onClick={() => setEmailLocale(l)} style={segBtn(emailLocale === l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {/* 메일 종류 10종 — 좁은 화면에서 한 줄에 안 들어가면 줄바꿈된다(버튼 스타일은 그대로). */}
          <div style={{
            display: 'inline-flex', flexWrap: 'wrap', rowGap: 3, maxWidth: '100%',
            background: 'var(--bg-subtle)', borderRadius: 8, padding: 3,
          }}>
            {types.map(ty => (
              <button key={ty.key} onClick={() => setType(ty.key)} style={segBtn(type === ty.key)}>
                {ty.label}
              </button>
            ))}
          </div>
          {/* 플랜 토글 — 다이제스트에만 영향(광고 슬롯). 다른 메일엔 광고가 없어 숨긴다. */}
          {type === 'digest' && (
            <div style={{ display: 'inline-flex', background: 'var(--bg-subtle)', borderRadius: 8, padding: 3 }}>
              {(['free', 'pro'] as const).map(p => (
                <button key={p} onClick={() => setPlan(p)} style={segBtn(plan === p)}>
                  {p === 'pro' ? 'Pro' : 'Free'}
                </button>
              ))}
            </div>
          )}
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
