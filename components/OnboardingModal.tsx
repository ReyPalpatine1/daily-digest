'use client'

import { Fragment, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePending } from '@/lib/use-pending'
import ConfirmModal, { ModalText } from '@/components/ConfirmModal'

type TFn = (key: string, params?: Record<string, string | number>) => string

// /api/consent 응답의 갱신된 동의 필드 — profiles의 같은 이름 컬럼.
export type ConsentFields = {
  terms_agreed_at: string | null
  ad_consent: boolean
  ad_consent_at: string | null
  ad_withdrawn_at: string | null
}

type Props = {
  t: TFn
  // POST /api/consent 성공 — 다음 안내(기존 도움말 팝업)는 호출부가 정한다.
  // fields: 서버가 돌려준 갱신된 동의 필드(조회 실패 시 null → 호출부가 프로필을 다시 읽는다).
  onAgreed: (fields: ConsentFields | null) => void
  // 오류 안내는 대시보드의 기존 하단 토스트로.
  onToast: (message: string) => void
}

// 첫 로그인 동의 팝업. 틀은 TrialPopup(자동으로 뜨는 큰 가운데 정렬 알림창)과 같다.
// 바깥 클릭·ESC로 닫히지 않는다. 동의 후 안내는 기존 도움말 팝업(HelpPopup)이 맡는다.
export default function OnboardingModal({ t, onAgreed, onToast }: Props) {
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreeAge, setAgreeAge] = useState(false)
  // 선택 항목은 미리 체크하지 않는다.
  const [agreeAds, setAgreeAds] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const agree = usePending()
  const leave = usePending()

  async function submitConsent() {
    await agree.run(async () => {
      try {
        const res = await fetch('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ads: agreeAds }),
        })
        if (!res.ok) throw new Error(`consent ${res.status}`)
        const data = await res.json().catch(() => null) as { profile?: ConsentFields | null } | null
        const fields = data?.profile
        onAgreed(fields && typeof fields.ad_consent === 'boolean' && fields.terms_agreed_at ? fields : null)
      } catch (e) {
        console.error('[OnboardingModal] 동의 실패:', e)
        onToast(t('onboarding.agreeFailed'))
      }
    })
  }

  async function cancelSignup() {
    await leave.run(async () => {
      try {
        // 신규 계정만 지우는 전용 경로(기존 회원은 서버가 403 not_new_account로 거부).
        const res = await fetch('/api/consent/decline', { method: 'POST' })
        if (!res.ok) throw new Error(`delete ${res.status}`)
        await supabase.auth.signOut()
        window.location.href = '/'
      } catch (e) {
        console.error('[OnboardingModal] 가입 취소 실패:', e)
        setShowLeave(false)
        onToast(t('onboarding.leaveFailed'))
      }
    })
  }

  // === 스타일 (TrialPopup·ConfirmModal과 같은 버튼 크기·색) ===
  const mainBtn: CSSProperties = {
    padding: '8px 14px', borderRadius: 8, border: 'none',
    background: 'var(--text-primary)', color: 'var(--bg-card)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
  const checkbox: CSSProperties = {
    width: 14, height: 14, margin: '3px 0 0', flexShrink: 0,
    accentColor: 'var(--text-primary)', cursor: 'pointer',
  }
  const checkRow: CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, cursor: 'pointer',
  }
  // 체크박스(14) + 간격(8) — 글자 시작선
  const textIndent = 22
  const docLink: CSSProperties = { color: 'var(--text-secondary)', textDecoration: 'underline' }

  // "{terms}"·"{privacy}" 자리에 새 탭 링크를 끼운다.
  function renderTermsLabel(): ReactNode {
    return t('onboarding.agreeTerms').split(/(\{terms\}|\{privacy\})/).map((part, i) => {
      if (part === '{terms}') {
        return <a key={i} href="/terms" target="_blank" rel="noopener noreferrer" style={docLink}
          onClick={e => e.stopPropagation()}>{t('onboarding.termsLink')}</a>
      }
      if (part === '{privacy}') {
        return <a key={i} href="/privacy" target="_blank" rel="noopener noreferrer" style={docLink}
          onClick={e => e.stopPropagation()}>{t('onboarding.privacyLink')}</a>
      }
      return <Fragment key={i}>{part}</Fragment>
    })
  }

  const requiredOk = agreeTerms && agreeAge

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 14,
        }}>
        <div
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          style={{
            width: '100%', maxWidth: 400,
            maxHeight: 'calc(100dvh - 28px)', overflowY: 'auto',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 14,
            padding: '28px 24px',
            boxSizing: 'border-box',
            boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
            textAlign: 'center',
          }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--bg-subtle)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', marginBottom: 16,
          }}>
            <ShieldCheck size={26} />
          </div>

          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
            {t('onboarding.consentTitle')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 18 }}>
            {t('onboarding.consentIntro')}
          </div>

          {/* 필수 ①② — TrialPopup 목록 박스와 같은 회색 박스, 줄 사이 0.5px 구분선 */}
          <div style={{
            textAlign: 'left', background: 'var(--bg-subtle)',
            border: '0.5px solid var(--border)', borderRadius: 8,
            padding: '4px 14px', marginBottom: 10,
          }}>
            <label style={{ ...checkRow, padding: '10px 0' }}>
              <input type="checkbox" checked={agreeTerms}
                onChange={e => setAgreeTerms(e.target.checked)} style={checkbox} />
              <span>{renderTermsLabel()}</span>
            </label>
            <div style={{ borderTop: '0.5px solid var(--border)' }} />
            <div style={{ padding: '10px 0' }}>
              <label style={checkRow}>
                <input type="checkbox" checked={agreeAge}
                  onChange={e => setAgreeAge(e.target.checked)} style={checkbox} />
                <span>{t('onboarding.agreeAge')}</span>
              </label>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, paddingLeft: textIndent, marginTop: 2 }}>
                {t('onboarding.agreeAgeNote')}
              </div>
            </div>
          </div>

          {/* 선택 ③ — 테두리만 있는 별도 묶음 */}
          <div style={{
            textAlign: 'left', border: '0.5px solid var(--border)', borderRadius: 8,
            padding: '10px 14px', marginBottom: 20,
          }}>
            <label style={checkRow}>
              <input type="checkbox" checked={agreeAds}
                onChange={e => setAgreeAds(e.target.checked)} style={checkbox} />
              <span>{t('onboarding.agreeAds')}</span>
            </label>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
              lineHeight: 1.6, paddingLeft: textIndent, marginTop: 4,
            }}>
              {t('onboarding.adsBenefit')}
            </div>
            <div style={{ paddingLeft: textIndent, marginTop: 4 }}>
              {[t('onboarding.adsNote1'), t('onboarding.adsNote2'), t('onboarding.adsNote3')].map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                  {'· '}{line}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={submitConsent}
              disabled={!requiredOk || agree.pending}
              style={{
                ...mainBtn,
                cursor: !requiredOk || agree.pending ? 'default' : 'pointer',
                opacity: !requiredOk || agree.pending ? 0.5 : 1,
              }}>
              {agree.pending ? t('common.processing') : t('onboarding.agreeStart')}
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowLeave(true)}
              disabled={agree.pending}
              style={{
                background: 'transparent', border: 'none', padding: 0,
                fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit',
                cursor: 'pointer', textDecoration: 'underline',
              }}>
              {t('onboarding.leave')}
            </button>
          </div>
        </div>
      </div>

      {/* 동의하지 않고 나가기 → 가입 취소 확인 */}
      {showLeave && (
        <ConfirmModal
          title={t('onboarding.leaveTitle')}
          cancelLabel={t('common.close')}
          confirmLabel={leave.pending ? t('common.processing') : t('onboarding.leaveConfirm')}
          busy={leave.pending}
          onConfirm={cancelSignup}
          onCancel={() => setShowLeave(false)}>
          <ModalText>{t('onboarding.leaveBody')}</ModalText>
        </ConfirmModal>
      )}
    </>
  )
}
