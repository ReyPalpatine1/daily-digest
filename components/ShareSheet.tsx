'use client'

import { useMemo, useState } from 'react'
import { X, Copy, Check, MessageCircle, Share2, Link, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { splitSentences } from '@/lib/summary-format'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  videoId: string
  videoTitle: string // 현재 미사용(호출부 유지용으로 시그니처에 잔존)
  keyPoints: string[]
  summary: string
  timeline: { time: string; content: string }[]
  userName: string // 이름 표시 토글 제거로 미사용(시그니처만 유지)
  t: TFn
  onClose: () => void
}

// 강조 가능한 한 줄 항목(핵심 포인트·요약 문장·타임라인 공용).
// 줄 클릭 = 강조 토글(다중). 체크 아이콘 없음 — 배경/좌측 바로만 상태 표시.
function AnnRow(props: { time?: string; text: string; highlighted: boolean; onToggle: () => void }) {
  const { time, text, highlighted, onToggle } = props
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
        background: highlighted ? 'rgba(255,205,0,0.16)' : 'transparent',
        boxShadow: highlighted ? 'inset 2px 0 0 var(--text-primary)' : 'none',
      }}>
      {time !== undefined && (
        <span style={{
          fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 34,
          fontVariantNumeric: 'tabular-nums', marginTop: 1,
          color: highlighted ? 'var(--text-primary)' : 'var(--text-tertiary)',
        }}>
          {time}
        </span>
      )}
      <span style={{
        fontSize: 12.5, lineHeight: 1.5, flex: 1,
        color: highlighted ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: highlighted ? 500 : 400,
      }}>
        {text}
      </span>
    </div>
  )
}

// 접이식 섹션(기본 닫힘). 헤더 클릭 시 해당 섹션만 토글(다른 섹션 영향 없음).
// 라벨 옆에 선택 개수(N개 선택)를 표시.
function CollapsibleSection(props: {
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const { label, count, open, onToggle, children } = props
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, padding: '11px 13px', borderRadius: 8,
          border: '0.5px solid var(--border)', background: 'var(--bg-card)',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
          {count > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count}개 선택</span>
          )}
        </span>
        {open
          ? <ChevronUp size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          : <ChevronDown size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
          {children}
        </div>
      )}
    </div>
  )
}

// 요약 공유 시트 — 접이식 통합 구조. 상단 메모 1개 + 핵심 포인트·요약·타임라인 3개 접이식 섹션.
// 각 섹션 항목/문장 클릭으로 다중 강조. 링크 생성 후에도 (a)~(d) 내용은 유지하고 하단 버튼만 전환.
// ※ 문구는 우선 한국어 하드코딩(i18n 키 추가는 백로그 — 수정 파일 범위 제한).
export default function ShareSheet({ videoId, keyPoints, summary, timeline, t, onClose }: Props) {
  const sentences = useMemo(() => splitSentences(summary), [summary])

  const [comment, setComment] = useState('')
  const [kpSel, setKpSel] = useState<Set<number>>(new Set())   // 핵심 포인트 인덱스
  const [sumSel, setSumSel] = useState<Set<string>>(new Set()) // 요약 문장 원문
  const [tlSel, setTlSel] = useState<Set<string>>(new Set())   // 타임라인 시각(time)
  const [open, setOpen] = useState<{ kp: boolean; sum: boolean; tl: boolean }>({ kp: false, sum: false, tl: false })
  const [creating, setCreating] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [kakaoNotice, setKakaoNotice] = useState(false)

  const toggleNum = (set: Set<number>, setter: (s: Set<number>) => void, v: number) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setter(next)
  }
  const toggleStr = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setter(next)
  }

  // 링크 생성(및 "새 링크 만들기" 재호출). 항상 새 토큰을 발급한다.
  const create = async () => {
    if (creating) return
    setCreating(true)
    setErrorMsg(null)
    try {
      // 강조된 항목만 annotations로 구성(원본 순서 유지, text는 원문 보존).
      const annKeyPoints = keyPoints
        .map((text, i) => ({ i, text }))
        .filter((x) => kpSel.has(x.i))
      const annSummary = sentences
        .filter((s) => sumSel.has(s))
        .map((text) => ({ text }))
      const annTimeline = timeline
        .filter((x) => tlSel.has(x.time))
        .map((x) => ({ time: x.time, text: x.content }))
      const annotations = { keyPoints: annKeyPoints, summary: annSummary, timeline: annTimeline }

      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          comment: comment.trim() || undefined,
          annotations,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        setShareUrl(data.url)
        // 생성 즉시 자동 복사 — await 뒤 clipboard는 사파리/모바일에서 막힐 수 있으므로 실패해도 무시(아래 복사 버튼이 안전망)
        try {
          await navigator.clipboard.writeText(data.url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
        } catch {
          // 무시
        }
      } else {
        setErrorMsg('링크 생성에 실패했어요. 잠시 후 다시 시도해 주세요.')
      }
    } catch {
      setErrorMsg('링크 생성에 실패했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setCreating(false)
    }
  }

  const copy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // 복사 실패 시 폴백 없이 조용히
    }
  }

  const hasSelectable = keyPoints.length > 0 || sentences.length > 0 || timeline.length > 0

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
          width: '100%', maxWidth: 440,
          maxHeight: 'calc(100dvh - 28px)', overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
        }}>
        {/* (a) 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            fontSize: 16, fontWeight: 700, color: 'var(--text-primary)',
          }}>
            <Share2 size={16} /> 요약 공유하기
          </span>
          <button
            onClick={onClose}
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

        {/* (b) 메모 남기기 */}
        <div style={{ marginBottom: -3 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 3,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
              color: 'var(--text-tertiary)',
            }}>
              메모 남기기
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
              {comment.length}/100
            </div>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 100))}
            maxLength={100}
            rows={2}
            placeholder="예: 초반은 넘기고 여기부터 보세요"
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'none',
              background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
              borderRadius: 9, padding: '10px 12px',
              fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>

        {/* (c) 안내 + (d) 접이식 섹션 3개 */}
        {hasSelectable && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              강조할 부분을 골라주세요 (선택)
            </div>

            {keyPoints.length > 0 && (
              <CollapsibleSection
                label="핵심 포인트"
                count={kpSel.size}
                open={open.kp}
                onToggle={() => setOpen((o) => ({ ...o, kp: !o.kp }))}>
                {keyPoints.map((text, i) => (
                  <AnnRow
                    key={i}
                    text={text}
                    highlighted={kpSel.has(i)}
                    onToggle={() => toggleNum(kpSel, setKpSel, i)}
                  />
                ))}
              </CollapsibleSection>
            )}

            {sentences.length > 0 && (
              <CollapsibleSection
                label="요약"
                count={sumSel.size}
                open={open.sum}
                onToggle={() => setOpen((o) => ({ ...o, sum: !o.sum }))}>
                {sentences.map((s, i) => (
                  <AnnRow
                    key={i}
                    text={s}
                    highlighted={sumSel.has(s)}
                    onToggle={() => toggleStr(sumSel, setSumSel, s)}
                  />
                ))}
              </CollapsibleSection>
            )}

            {timeline.length > 0 && (
              <CollapsibleSection
                label="타임라인"
                count={tlSel.size}
                open={open.tl}
                onToggle={() => setOpen((o) => ({ ...o, tl: !o.tl }))}>
                {timeline.map((item, i) => (
                  <AnnRow
                    key={i}
                    time={item.time}
                    text={item.content}
                    highlighted={tlSel.has(item.time)}
                    onToggle={() => toggleStr(tlSel, setTlSel, item.time)}
                  />
                ))}
              </CollapsibleSection>
            )}
          </>
        )}

        {errorMsg && (
          <div style={{ fontSize: 12, color: 'var(--danger)' }}>{errorMsg}</div>
        )}

        {/* (e) 하단 — 생성 전/후 버튼 자리만 전환((a)~(d)는 유지) */}
        {!shareUrl ? (
          <button
            onClick={create}
            disabled={creating}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '11px 14px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: 'var(--bg-card)',
              fontSize: 13.5, fontWeight: 600, cursor: creating ? 'default' : 'pointer',
              fontFamily: 'inherit', opacity: creating ? 0.6 : 1,
            }}>
            <Link size={15} /> {creating ? '생성 중…' : '공유하기'}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 링크 박스 + 복사 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                flex: 1, minWidth: 0,
                fontSize: 12.5, color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
                borderRadius: 8, padding: '10px 12px', lineHeight: 1.4,
              }}>
                {shareUrl}
              </div>
              <button
                onClick={copy}
                style={{
                  flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: 'var(--bg-card)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? '복사됨' : '복사'}
              </button>
            </div>
            {/* 새 링크 만들기 + 카카오톡 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={create}
                disabled={creating}
                style={{
                  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 8,
                  background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
                  cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit',
                  opacity: creating ? 0.6 : 1,
                }}>
                <RefreshCw size={15} /> {creating ? '생성 중…' : '새 링크 만들기'}
              </button>
              <button
                onClick={() => {
                  setKakaoNotice(true)
                  setTimeout(() => setKakaoNotice(false), 2500)
                }}
                style={{
                  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 8,
                  background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                  color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', opacity: 0.6,
                }}>
                <MessageCircle size={15} /> 카카오톡으로 보내기
              </button>
            </div>
            {kakaoNotice && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                카카오톡 공유는 준비 중이에요. 링크를 복사해 붙여넣어 주세요.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
