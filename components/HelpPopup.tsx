'use client'

import { useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  t: TFn
  isMobile: boolean
  // dontShowAgain=true 면 부모가 help_seen=true 저장. false면 저장 안 함.
  onClose: (dontShowAgain: boolean) => void
}

// 미니 UI 공용 토큰 (모두 CSS 변수만 사용 — 하드코딩 색 금지)
const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
}
const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
  borderRadius: 999, padding: '2px 8px',
  fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
}
const pillBtn: React.CSSProperties = {
  background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
  borderRadius: 6, padding: '3px 8px',
  fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
}
const fakeInput: React.CSSProperties = {
  background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
  borderRadius: 6, padding: '4px 8px',
  fontSize: 10, color: 'var(--text-tertiary)',
}
const dot = (filled: boolean): React.CSSProperties => ({
  width: 10, height: 10, borderRadius: '50%',
  background: filled ? 'var(--accent)' : 'var(--bg-subtle)',
  border: filled ? 'none' : '0.5px solid var(--border)',
})

// ─── 미니 UI 일러스트 (실제 대시보드를 단순화해 본뜸) ───

function MiniChannels({ t }: { t: TFn }) {
  return (
    <div style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('help.sample.myChannels')}</span>
        <div style={{ display: 'flex', gap: 5 }}>
          <span style={pillBtn}>{t('dashboard.addCategory')}</span>
          <span style={{ ...pillBtn, background: 'var(--accent)', color: 'var(--bg-card)', border: 'none' }}>{t('dashboard.addChannel')}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        <span style={{ ...fakeInput, width: 26, textAlign: 'center' }}>📺</span>
        <span style={{ ...fakeInput, flex: 1 }}>https://youtube.com/@…</span>
        <span style={{ ...fakeInput, width: 54 }}>{t('common.alias')}</span>
      </div>
      {[
        { e: '💻', a: t('help.sample.ch1'), c: t('help.sample.catIt') },
        { e: '📰', a: t('help.sample.ch2'), c: t('help.sample.catNews') },
      ].map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', ...card, background: 'var(--bg-subtle)' }}>
          <span style={{ fontSize: 13 }}>{row.e}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{row.a}</span>
          <span style={chip}>{row.c}</span>
        </div>
      ))}
    </div>
  )
}

function MiniCategories({ t }: { t: TFn }) {
  const groups = [
    { cat: t('help.sample.catIt'), chans: [{ e: '💻', a: t('help.sample.ch1') }, { e: '🤖', a: t('help.sample.ch3') }] },
    { cat: t('help.sample.catNews'), chans: [{ e: '📰', a: t('help.sample.ch2') }] },
  ]
  return (
    <div style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groups.map((g, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...chip, alignSelf: 'flex-start', background: 'var(--accent)', color: 'var(--bg-card)', border: 'none', fontWeight: 700 }}>{g.cat}</span>
          {g.chans.map((c, j) => (
            <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', marginLeft: 10, ...card, background: 'var(--bg-subtle)' }}>
              <span style={{ fontSize: 13 }}>{c.e}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{c.a}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MiniSchedule({ t }: { t: TFn }) {
  return (
    <div style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t('help.sample.sendTime')}</span>
        <span style={{ ...chip, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', padding: '3px 12px' }}>07:00</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ ...pillBtn, flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--accent)', color: 'var(--bg-card)', border: 'none' }}>
          <span style={{ ...dot(false), width: 8, height: 8, background: 'var(--bg-card)' }} />{t('help.sample.byEmail')}
        </span>
        <span style={{ ...pillBtn, flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ ...dot(false), width: 8, height: 8 }} />{t('help.sample.byTelegram')}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{t('help.sample.breakingKeyword')}</span>
        <span style={{ ...fakeInput, alignSelf: 'flex-start' }}>{t('help.sample.breakingSample')}</span>
      </div>
    </div>
  )
}

function MiniHistory({ t }: { t: TFn }) {
  const items = [
    { e: '💻', ch: t('help.sample.ch1'), title: t('help.sample.title1') },
    { e: '📰', ch: t('help.sample.ch2'), title: t('help.sample.title2') },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13 }}>{it.e}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{it.ch}</span>
            <Mail t={t} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{it.title}</span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{t('help.sample.summaryLine')}</span>
        </div>
      ))}
    </div>
  )
}

// 작은 메일 아이콘 (lucide). t는 미사용이지만 시그니처 통일.
function Mail(_: { t: TFn }) {
  return (
    <span style={{ ...chip, padding: '2px 6px', gap: 0 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    </span>
  )
}

export default function HelpPopup({ t, isMobile, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(false)
  const total = 4

  const steps = [
    { mini: <MiniChannels t={t} />, title: t('help.step1_title'), desc: t('help.step1_desc') },
    { mini: <MiniCategories t={t} />, title: t('help.step2_title'), desc: t('help.step2_desc') },
    { mini: <MiniSchedule t={t} />, title: t('help.step3_title'), desc: t('help.step3_desc') },
    { mini: <MiniHistory t={t} />, title: t('help.step4_title'), desc: t('help.step4_desc') },
  ]
  const isFirst = step === 0
  const isLast = step === total - 1
  const cur = steps[step]

  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    width: 36, height: 36, borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    color: 'var(--text-secondary)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    fontFamily: 'inherit', flexShrink: 0,
  })

  return (
    <div
      onClick={() => onClose(dontShow)}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? 16 : 24,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 420,
          maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 16,
          padding: isMobile ? 18 : 22,
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
        }}>
        {/* 상단: 진행표시 + 닫기 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>{step + 1} / {total}</span>
          <button
            onClick={() => onClose(dontShow)}
            aria-label={t('common.close')}
            style={{
              width: 30, height: 30, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontFamily: 'inherit',
            }}>
            <X size={18} />
          </button>
        </div>

        {/* 미니 UI 일러스트 */}
        <div style={{
          background: 'var(--bg-subtle)',
          border: '0.5px solid var(--border)',
          borderRadius: 12, padding: 14,
        }}>
          {cur.mini}
        </div>

        {/* 제목 + 설명 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: isMobile ? undefined : 96 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{cur.title}</h3>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{cur.desc}</p>
        </div>

        {/* 점 인디케이터 */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 7 }}>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} style={dot(i === step)} />
          ))}
        </div>

        {/* 좌우 이동 / 시작하기 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button
            onClick={() => !isFirst && setStep((s) => s - 1)}
            disabled={isFirst}
            aria-label={t('help.prev')}
            style={arrowBtn(isFirst)}>
            <ChevronLeft size={20} />
          </button>

          {isLast ? (
            <button
              onClick={() => onClose(dontShow)}
              style={{
                flex: 1, height: 40, borderRadius: 999,
                background: 'var(--accent)', color: 'var(--bg-card)',
                border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              }}>
              {t('help.start')}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              aria-label={t('help.next')}
              style={arrowBtn(false)}>
              <ChevronRight size={20} />
            </button>
          )}
        </div>

        {/* 다시 보지 않기 — 좌우 이동 줄과 충분히 떨어뜨림 */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: 6, cursor: 'pointer',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
            style={{ width: 13, height: 13, cursor: 'pointer', accentColor: 'var(--accent)' }}
          />
          {t('help.dontShowAgain')}
        </label>
      </div>
    </div>
  )
}
