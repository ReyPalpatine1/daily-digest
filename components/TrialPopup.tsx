'use client'

import { Clock, Mail } from 'lucide-react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  variant: 'ending' | 'ended'
  endDateLabel?: string
  t: TFn
  onClose: () => void
  onSubscribe: () => void
}

// Pro 체험 종료 안내 팝업 — 전날(ending) / 종료 당일(ended) 2종.
// 모달 뼈대(오버레이·그림자·카드 톤)는 HelpPopup을 미러링. 카드가 좁아(maxWidth 400)
// 모바일 분기 없이 HelpPopup 모바일 처리(width 100% + dvh 제한 + 오버레이 패딩 14)를 항상 적용.
// 자동 결제 안내는 endingBody 본문에 포함되므로 별도 하단 캡션은 두지 않는다(중복 방지).
export default function TrialPopup({ variant, endDateLabel, t, onClose, onSubscribe }: Props) {
  const Icon = variant === 'ending' ? Clock : Mail

  const subBtn: React.CSSProperties = {
    flex: 1, height: 42, borderRadius: 9,
    border: '0.5px solid var(--border)', background: 'transparent',
    color: 'var(--text-secondary)', fontSize: 13.5,
    cursor: 'pointer', fontFamily: 'inherit',
  }
  const mainBtn: React.CSSProperties = {
    flex: 1, height: 42, borderRadius: 9, border: 'none',
    background: 'var(--text-primary)', color: 'var(--bg-card)',
    fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 14,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
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
          <Icon size={26} />
        </div>

        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
          {variant === 'ending' ? t('trialPopup.endingTitle') : t('trialPopup.endedTitle')}
        </div>

        <div style={{
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7,
          marginBottom: 18, whiteSpace: 'pre-line',
        }}>
          {variant === 'ending'
            ? t('trialPopup.endingBody', { date: endDateLabel ?? '' })
            : t('trialPopup.endedBody')}
        </div>

        {variant === 'ended' && (
          <div style={{
            textAlign: 'left', background: 'var(--bg-subtle)',
            border: '0.5px solid var(--border)', borderRadius: 8,
            padding: '12px 14px', marginBottom: 20,
          }}>
            {[t('trialPopup.lossChannels'), t('trialPopup.lossDelivery'), t('trialPopup.lossHistory')].map((line, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.9 }}>{line}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={subBtn}>
            {variant === 'ending' ? t('trialPopup.later') : t('trialPopup.close')}
          </button>
          <button onClick={onSubscribe} style={mainBtn}>
            {t('trialPopup.subscribe')}
          </button>
        </div>
      </div>
    </div>
  )
}
