'use client'

import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, Mail, Play, ChevronDown, Link2, Lock } from 'lucide-react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  t: TFn
  isMobile: boolean
  // 열 때의 체크박스 초기값(= 현재 settings.help_seen). 닫을 때 이 값(변경 포함)을 부모가 저장.
  initialDontShow: boolean
  // 현재 플랜. 무료(false)면 Pro 전용 항목에 잠금 뱃지를 붙인다.
  // 미전달 시 무료로 간주 — 잘못 알려주는 쪽보다 막힌 걸 알려주는 쪽이 안전하다.
  isPro?: boolean
  onClose: (dontShowAgain: boolean) => void
}

// ── 공용 토큰 (전부 CSS 변수 / 흑백, 하드코딩·빨강 금지) ──
// ※ 단계 수(TOTAL)는 steps 배열 길이에서 파생시킨다(HelpPopup 내부) — 단계를 늘려도
//    헤더의 n/N·점 표시·마지막 단계 버튼이 자동으로 따라온다.

// 공유 강조(형광펜) — 공유 시트·공유 페이지·타임라인이 쓰는 값과 같아야 한다.
// 도움말 목업만 다른 색을 쓰면 실제 화면과 다른 것을 가르치게 되므로 같은 값을 쓴다.
// 반투명 노랑이라 라이트/다크 어느 배경 위에서도 아래 글자가 그대로 읽힌다.
// (ShareSheet.tsx · ShareVideo.tsx · app/s/[token]/page.tsx와 동일)
const SHARE_HIGHLIGHT_BG = 'rgba(255,205,0,0.20)'

// 탭 바: 현재 스텝 탭만 활성(굵게 + 밑줄)
function TabBar({ t, active }: { t: TFn; active: number }) {
  const tabs = [t('nav.channels'), t('nav.schedule'), t('nav.history')]
  return (
    <div style={{ display: 'flex', gap: 18, borderBottom: '0.5px solid var(--border)', paddingBottom: 8 }}>
      {tabs.map((label, i) => (
        <span
          key={i}
          style={{
            fontSize: 13,
            whiteSpace: 'nowrap',
            paddingBottom: 7,
            marginBottom: -8.5,
            fontWeight: i === active ? 700 : 500,
            color: i === active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            borderBottom: i === active ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
          {label}
        </span>
      ))}
    </div>
  )
}

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
  background: 'var(--bg-card)', border: '0.5px solid var(--border)',
  borderRadius: 999, padding: '2px 9px',
  fontSize: 11, color: 'var(--text-secondary)',
}

// "+ 채널 추가" 버튼 스타일. 실제 대시보드 primaryBtn(accent 배경 + bg-card 글자)과 동일하게.
// CSS 변수라 테마 반전됨: 라이트=검정 버튼, 다크=흰 버튼 → 두 테마 모두 실제 버튼과 일치.
// 미니 프리뷰 + 설명 인라인 버튼이 이 객체를 공유(절대 다르게 보이면 안 됨).
const addChannelBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
  background: 'var(--accent)', color: 'var(--bg-card)',
  border: 'none',
  borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600,
}
// 인라인(문장 안)용: 동일 디자인 그대로, 크기만 살짝 축소
const addChannelBtnInlineStyle: React.CSSProperties = {
  ...addChannelBtnStyle,
  padding: '2px 8px',
  verticalAlign: 'middle',
}

// ── 미니 프리뷰: 채널 탭 ──
function PreviewChannels({ t }: { t: TFn }) {
  const rows = [
    { ch: t('help.sample.ch1'), cat: t('help.sample.cat1'), time: t('help.sample.justAdded'), hot: true },
    { ch: t('help.sample.ch2'), cat: t('help.sample.cat2'), time: t('help.sample.time2'), hot: false },
    { ch: t('help.sample.ch3'), cat: t('help.sample.cat3'), time: t('help.sample.time3'), hot: false },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabBar t={t} active={0} />
      {/* 실제 대시보드와 같은 위치감 — 미리보기는 채널 목록 위, 채널 추가는 오른쪽 끝. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={addChannelBtnStyle}>{t('preview.cta')}</span>
        <span style={addChannelBtnStyle}>{t('dashboard.addChannel')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 9,
            background: 'var(--bg-card)',
            border: r.hot ? '1.5px solid var(--accent)' : '0.5px solid var(--border)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{r.ch}</span>
            <span style={chip}>{r.cat}</span>
            <span style={{ flex: 1 }} />
            <span style={{
              fontSize: 11, whiteSpace: 'nowrap',
              color: r.hot ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: r.hot ? 600 : 400,
              ...(r.hot ? { background: 'var(--bg-subtle)', borderRadius: 999, padding: '2px 9px' } : {}),
            }}>
              {r.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 미니 프리뷰: 발송 설정 탭 ──
function PreviewSchedule({ t }: { t: TFn }) {
  const row = (label: string, right: React.ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 14px', borderRadius: 9,
      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{label}</span>
      {right}
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabBar t={t} active={1} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {row(t('schedule.sendTime'), (
          <span style={{ ...chip, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', gap: 5, padding: '4px 11px' }}>
            {t('help.sample.sendTimeValue')} <ChevronDown size={13} />
          </span>
        ))}
        {row(t('schedule.channels'), (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            background: 'var(--accent)', color: 'var(--bg-card)',
            borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 600,
          }}>
            <Mail size={13} /> {t('schedule.emailChannel')}
          </span>
        ))}
        {row(t('schedule.breaking'), (
          <span style={chip}>{t('help.sample.breakingSample')}</span>
        ))}
      </div>
    </div>
  )
}

// ── 미니 프리뷰: 열람 기록 탭 ──
function PreviewHistory({ t }: { t: TFn }) {
  const cards = [
    { title: t('help.sample.title1'), ch: t('help.sample.ch1'), cat: t('help.sample.cat1'), date: t('help.sample.date1') },
    { title: t('help.sample.title2'), ch: t('help.sample.ch2'), cat: t('help.sample.cat2'), date: t('help.sample.date2') },
    { title: t('help.sample.title3'), ch: t('help.sample.ch3'), cat: t('help.sample.cat3'), date: t('help.sample.date3') },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabBar t={t} active={2} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {cards.map((c, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 11,
            padding: '10px 12px', borderRadius: 9,
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          }}>
            <span style={{
              width: 46, height: 32, borderRadius: 6, flexShrink: 0,
              background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-tertiary)',
            }}>
              <Play size={14} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {c.title}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                {c.ch} · {c.cat} · {c.date}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 미니 프리뷰: 요약 공유 시트 ──
// 공유는 열람 기록에서 시작하므로 탭 바는 열람 기록에 맞춘다(설명 문구와 같은 위치).
// 구성은 실제 ShareSheet 순서 그대로 — 메모 입력칸 → 핵심 포인트(강조) → 공유 버튼.
function PreviewShare({ t }: { t: TFn }) {
  // 항목 행 — 강조 여부와 무관하게 같은 여백을 줘 강조가 붙어도 글자가 움직이지 않는다.
  // 좌우 -9px는 공유 시트·공유 페이지와 같은 규칙(항목 단위를 드러냄).
  const pointRow = (text: string, highlighted: boolean) => (
    <div style={{
      margin: '0 -9px', padding: '3px 9px', borderRadius: 6,
      fontSize: 12.5, lineHeight: 1.6,
      color: highlighted ? 'var(--text-primary)' : 'var(--text-secondary)',
      ...(highlighted ? { background: SHARE_HIGHLIGHT_BG } : {}),
    }}>
      {text}
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TabBar t={t} active={2} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {/* 메모 입력칸 모양 — 실제 시트의 textarea와 같은 톤(placeholder 색) */}
        <div style={{
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderRadius: 9, padding: '10px 12px',
          fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5,
        }}>
          {t('help.sample.memoPlaceholder')}
        </div>

        {/* 핵심 포인트 — 한 줄에만 형광펜을 입혀 강조 기능을 보여준다 */}
        <div style={{
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderRadius: 9, padding: '12px 14px',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
            color: 'var(--text-muted)', marginBottom: 8,
          }}>
            {t('history.keyPoints')}
          </div>
          {pointRow(t('help.sample.point1'), true)}
          {pointRow(t('help.sample.point2'), false)}
        </div>

        {/* 공유하기 버튼 — 실제 시트와 같이 전체 폭 accent 버튼 */}
        <span style={{
          ...addChannelBtnStyle,
          justifyContent: 'center', gap: 6,
          padding: '9px 12px',
        }}>
          <Link2 size={13} /> {t('help.sample.shareBtn')}
        </span>
      </div>
    </div>
  )
}

// Pro 전용 잠금 뱃지 — 대시보드의 잠금 뱃지(proBadge + <Lock size={11} /> + stats.proOnly)와 같은 구성.
// 화면에서 자물쇠로 막아둔 기능과 도움말이 같은 표시를 써야 사용자가 둘을 연결한다(새 모양 금지).
// 문장 안에 들어가므로 verticalAlign/marginRight만 더한다.
const proLockBadge: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
  color: 'var(--text-muted)', background: 'var(--bg-subtle)',
  padding: '2px 7px', borderRadius: 4,
  whiteSpace: 'nowrap', verticalAlign: 'middle',
  marginRight: 6,
}

// 번호(①②③) 단계 안내 한 줄. 번호와 멘트를 세로 가운데 정렬(두 줄이어도 번호가 중앙).
function NumberedStep({ n, text }: { n: number; text: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        background: 'var(--accent)', color: 'var(--bg-card)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700,
      }}>
        {n}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{text}</span>
    </div>
  )
}

// 설명 문장 안의 {addBtn} 토큰을 미니 프리뷰와 동일한 "+ 채널 추가" 버튼으로 치환.
function renderItem(t: TFn, raw: string): React.ReactNode {
  if (!raw.includes('{addBtn}')) return raw
  const [before, after] = raw.split('{addBtn}')
  return (
    <>
      {before}
      <span style={addChannelBtnInlineStyle}>{t('dashboard.addChannel')}</span>
      {after}
    </>
  )
}

export default function HelpPopup({ t, isMobile, initialDontShow, isPro = false, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(initialDontShow)

  // Pro 전용 항목에만 붙는 잠금 표시. 무료 사용자에게만 보인다(Pro에겐 문장만).
  // 대상은 발송 설정의 텔레그램(step2_2)·속보 키워드(step2_3) 둘뿐 —
  // 미리보기(step1_3)와 공유(step4)는 무료도 쓰는 기능이라 붙이지 않는다.
  const lockFree = !isPro

  const steps: { preview: React.ReactNode; key: string; items: { text: string; locked?: boolean }[] }[] = [
    { preview: <PreviewChannels t={t} />, key: 'step1', items: [{ text: t('help.step1_1') }, { text: t('help.step1_2') }, { text: t('help.step1_3') }] },
    { preview: <PreviewSchedule t={t} />, key: 'step2', items: [{ text: t('help.step2_1') }, { text: t('help.step2_2'), locked: lockFree }, { text: t('help.step2_3'), locked: lockFree }] },
    { preview: <PreviewHistory t={t} />, key: 'step3', items: [{ text: t('help.step3_1') }, { text: t('help.step3_2') }, { text: t('help.step3_3') }] },
    { preview: <PreviewShare t={t} />, key: 'step4', items: [{ text: t('help.step4_1') }, { text: t('help.step4_2') }, { text: t('help.step4_3') }] },
  ]
  // 단계 수는 배열에서 파생 — 헤더 n/N·점 표시·마지막 단계 버튼이 함께 따라온다.
  const TOTAL = steps.length
  const isFirst = step === 0
  const isLast = step === TOTAL - 1
  const cur = steps[step]
  const k = cur.key

  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
    height: 40, padding: '0 16px', borderRadius: 999,
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1, fontFamily: 'inherit', flexShrink: 0,
  })

  return (
    <div
      onClick={() => onClose(dontShow)}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? 14 : 24,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: isMobile ? '100%' : 720,
          maxWidth: isMobile ? 440 : 720,
          height: isMobile ? 'auto' : 680,
          maxHeight: isMobile ? 'calc(100dvh - 28px)' : 680,
          overflowY: isMobile ? 'auto' : 'hidden',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 16,
          padding: isMobile ? 20 : 32,
          display: 'flex', flexDirection: 'column',
          gap: isMobile ? 16 : 18,
          boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
        }}>
        {/* 헤더: n/N + 닫기 (고정) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)' }}>{step + 1} / {TOTAL}</span>
          <button
            onClick={() => onClose(dontShow)}
            aria-label={t('common.close')}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontFamily: 'inherit',
            }}>
            <X size={19} />
          </button>
        </div>

        {/* 미니 프리뷰 (고정 높이, bg-subtle 한 겹) */}
        <div style={{
          flexShrink: 0,
          height: isMobile ? undefined : 290,
          background: 'var(--bg-subtle)',
          border: '0.5px solid var(--border)',
          borderRadius: 12,
          padding: isMobile ? 16 : 20,
          overflow: 'hidden',
        }}>
          {cur.preview}
        </div>

        {/* 설명 영역 (나머지 채움 → 스텝 간 높이 불변).
            데스크톱은 팝업 높이가 고정이라, 문구가 긴 언어에서 넘치면 잘리는 대신 이 영역만 스크롤된다
            (문구가 들어가는 평소에는 스크롤바가 생기지 않아 보이는 모습은 그대로). */}
        <div style={{
          flex: isMobile ? undefined : 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          overflowY: isMobile ? undefined : 'auto',
        }}>
          <h3 style={{ margin: 0, fontSize: isMobile ? 20 : 23, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t(`help.${k}_title`)}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
            {cur.items.map((item, i) => (
              <NumberedStep key={i} n={i + 1} text={
                <>
                  {item.locked && (
                    <span style={proLockBadge}>
                      <Lock size={11} />{t('stats.proOnly')}
                    </span>
                  )}
                  {renderItem(t, item.text)}
                </>
              } />
            ))}
          </div>
        </div>

        {/* 하단 네비: 이전 / 점 / 다음·확인 (고정) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
          <button
            onClick={() => !isFirst && setStep((s) => s - 1)}
            disabled={isFirst}
            style={arrowBtn(isFirst)}>
            <ChevronLeft size={17} /> {t('help.prev')}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {Array.from({ length: TOTAL }).map((_, i) => (
              <span key={i} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: i === step ? 'var(--accent)' : 'var(--bg-subtle)',
                border: i === step ? 'none' : '0.5px solid var(--border)',
              }} />
            ))}
          </div>

          {isLast ? (
            <button
              onClick={() => onClose(dontShow)}
              style={{
                ...arrowBtn(false),
                background: 'var(--accent)', color: 'var(--bg-card)', border: 'none',
                padding: '0 22px',
              }}>
              {t('help.confirm')}
            </button>
          ) : (
            <button onClick={() => setStep((s) => s + 1)} style={arrowBtn(false)}>
              {t('help.next')} <ChevronRight size={17} />
            </button>
          )}
        </div>

        {/* 다시 보지 않기 — 좌하단, 네비와 간격 두고 (고정) */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
          cursor: 'pointer', flexShrink: 0,
          fontSize: 12, color: 'var(--text-muted)',
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
