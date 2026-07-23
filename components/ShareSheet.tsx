'use client'

import { useState } from 'react'
import { X, Copy, Check, MessageCircle, Share2, MessageSquarePlus, Link } from 'lucide-react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  videoId: string
  videoTitle: string // 현재 미사용(호출부 유지용으로 시그니처에 잔존)
  keyPoints: string[]
  timeline: { time: string; content: string }[]
  userName: string // 이름 표시 토글 제거로 미사용(시그니처만 유지)
  t: TFn
  onClose: () => void
}

// 강조/메모 가능한 한 줄 항목(핵심 포인트·타임라인 공용).
// 줄 클릭 = 강조 토글(다중), 우측 말풍선 아이콘 = 항목 메모 입력창 토글.
function AnnRow(props: {
  time?: string
  text: string
  highlighted: boolean
  noteOpen: boolean
  note: string
  placeholder: string
  onToggleHighlight: () => void
  onToggleNote: () => void
  onNoteChange: (v: string) => void
}) {
  const { time, text, highlighted, noteOpen, note, placeholder,
    onToggleHighlight, onToggleNote, onNoteChange } = props
  return (
    <div style={{ borderRadius: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        padding: '8px 8px 8px 10px', borderRadius: 6,
        background: highlighted ? 'rgba(255,205,0,0.16)' : 'transparent',
        boxShadow: highlighted ? 'inset 2px 0 0 var(--text-primary)' : 'none',
      }}>
        {/* 클릭 영역 = 강조 토글 */}
        <div
          onClick={onToggleHighlight}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1,
            minWidth: 0, cursor: 'pointer',
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
          {highlighted && (
            <Check size={13} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-primary)' }} />
          )}
        </div>
        {/* 메모 입력창 토글 */}
        <button
          onClick={onToggleNote}
          aria-label="메모 달기"
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: noteOpen ? 'var(--bg-subtle)' : 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            color: (noteOpen || note.trim()) ? 'var(--text-primary)' : 'var(--text-tertiary)',
          }}>
          <MessageSquarePlus size={15} />
        </button>
      </div>
      {noteOpen && (
        <div style={{ padding: '0 8px 8px 10px' }}>
          <input
            value={note}
            onChange={(e) => onNoteChange(e.target.value.slice(0, 100))}
            maxLength={100}
            placeholder={placeholder}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 7, padding: '7px 10px',
              fontSize: 12.5, color: 'var(--text-primary)',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>
      )}
    </div>
  )
}

// 요약 공유 시트 — 한 장 통합 구조. 핵심 포인트·타임라인을 모두 표시하고,
// 각 항목을 다중 강조 + 항목별 메모 작성 가능. (HelpPopup/TrialPopup 모달 뼈대 미러링, CSS 변수만)
// ※ 문구는 우선 한국어 하드코딩(i18n 키 추가는 백로그 — 수정 파일 범위 제한).
export default function ShareSheet({ videoId, keyPoints, timeline, t, onClose }: Props) {
  const [comment, setComment] = useState('')
  // 인덱스/시각 → note(강조되어 있으면 Map에 존재, 값은 메모 원문). 메모 없이 강조만이면 값은 ''.
  const [kpSel, setKpSel] = useState<Map<number, string>>(new Map())
  const [tlSel, setTlSel] = useState<Map<string, string>>(new Map())
  // 항목 메모 입력창이 열린 상태(강조와 별개 — 강조만 켜고 메모창은 닫힌 상태 가능).
  const [kpNoteOpen, setKpNoteOpen] = useState<Set<number>>(new Set())
  const [tlNoteOpen, setTlNoteOpen] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [kakaoNotice, setKakaoNotice] = useState(false)

  // ── 핵심 포인트 강조/메모 조작 ──
  const toggleKp = (i: number) => {
    const has = kpSel.has(i)
    const next = new Map(kpSel)
    if (has) next.delete(i)
    else next.set(i, '')
    setKpSel(next)
    if (has) {
      // 강조 해제 → 메모 입력창도 닫기
      const open = new Set(kpNoteOpen)
      open.delete(i)
      setKpNoteOpen(open)
    }
  }
  const toggleKpNote = (i: number) => {
    const isOpen = kpNoteOpen.has(i)
    const open = new Set(kpNoteOpen)
    if (isOpen) open.delete(i)
    else open.add(i)
    setKpNoteOpen(open)
    // 메모창을 열면 강조도 함께 켠다(메모만 있고 강조 없는 상태 방지).
    if (!isOpen && !kpSel.has(i)) {
      const next = new Map(kpSel)
      next.set(i, '')
      setKpSel(next)
    }
  }
  const setKpNote = (i: number, v: string) => {
    const next = new Map(kpSel)
    next.set(i, v.slice(0, 100))
    setKpSel(next)
  }

  // ── 타임라인 강조/메모 조작 ──
  const toggleTl = (time: string) => {
    const has = tlSel.has(time)
    const next = new Map(tlSel)
    if (has) next.delete(time)
    else next.set(time, '')
    setTlSel(next)
    if (has) {
      const open = new Set(tlNoteOpen)
      open.delete(time)
      setTlNoteOpen(open)
    }
  }
  const toggleTlNote = (time: string) => {
    const isOpen = tlNoteOpen.has(time)
    const open = new Set(tlNoteOpen)
    if (isOpen) open.delete(time)
    else open.add(time)
    setTlNoteOpen(open)
    if (!isOpen && !tlSel.has(time)) {
      const next = new Map(tlSel)
      next.set(time, '')
      setTlSel(next)
    }
  }
  const setTlNote = (time: string, v: string) => {
    const next = new Map(tlSel)
    next.set(time, v.slice(0, 100))
    setTlSel(next)
  }

  const create = async () => {
    if (creating) return
    setCreating(true)
    setErrorMsg(null)
    try {
      // 강조된 항목만 annotations로 구성(원본 순서 유지, text는 원문 보존, 빈 메모는 제외).
      const annKeyPoints = keyPoints
        .map((text, i) => ({ text, i }))
        .filter((x) => kpSel.has(x.i))
        .map((x) => {
          const note = (kpSel.get(x.i) ?? '').trim()
          return note ? { i: x.i, text: x.text, note } : { i: x.i, text: x.text }
        })
      const annTimeline = timeline
        .filter((x) => tlSel.has(x.time))
        .map((x) => {
          const note = (tlSel.get(x.time) ?? '').trim()
          return note ? { time: x.time, text: x.content, note } : { time: x.time, text: x.content }
        })
      const annotations = { keyPoints: annKeyPoints, timeline: annTimeline }

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

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
    color: 'var(--text-tertiary)', marginBottom: 3,
  }
  const sectionHint: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
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
          width: '100%', maxWidth: 440,
          maxHeight: 'calc(100dvh - 28px)', overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
        }}>
        {/* 헤더 */}
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

        {shareUrl ? (
          /* ── 링크 생성됨 ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={sectionLabel}>링크 생성됨</div>
            <div style={{
              fontSize: 12.5, color: 'var(--text-primary)', wordBreak: 'break-all',
              background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
              borderRadius: 9, padding: '10px 12px', lineHeight: 1.5,
            }}>
              {shareUrl}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={copy}
                style={{
                  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: 'var(--bg-card)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? '복사됨' : '복사'}
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
                <MessageCircle size={15} /> 카카오톡
              </button>
            </div>
            {kakaoNotice && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                카카오톡 공유는 준비 중이에요. 링크를 복사해 붙여넣어 주세요.
              </div>
            )}
          </div>
        ) : (
          /* ── 작성 폼 (한 장 통합) ── */
          <>
            {/* 전체 메모 */}
            <div>
              <div style={sectionLabel}>메모 남기기</div>
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
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 3 }}>
                {comment.length}/100
              </div>
            </div>

            {/* 핵심 포인트 — 다중 강조 + 항목별 메모 */}
            {keyPoints.length > 0 && (
              <div>
                <div style={sectionLabel}>핵심 포인트</div>
                <div style={sectionHint}>눌러서 강조하거나 메모를 달 수 있어요</div>
                <div style={{
                  border: '0.5px solid var(--border-light)', borderRadius: 8, padding: 4,
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}>
                  {keyPoints.map((text, i) => (
                    <AnnRow
                      key={i}
                      text={text}
                      highlighted={kpSel.has(i)}
                      noteOpen={kpNoteOpen.has(i)}
                      note={kpSel.get(i) ?? ''}
                      placeholder="이 포인트에 메모 (선택)"
                      onToggleHighlight={() => toggleKp(i)}
                      onToggleNote={() => toggleKpNote(i)}
                      onNoteChange={(v) => setKpNote(i, v)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 타임라인 — 다중 강조 + 항목별 메모 */}
            {timeline.length > 0 && (
              <div>
                <div style={sectionLabel}>타임라인</div>
                <div style={sectionHint}>받는 사람이 여기부터 보게 됩니다</div>
                <div style={{
                  maxHeight: 148, overflowY: 'auto',
                  border: '0.5px solid var(--border-light)', borderRadius: 8, padding: 4,
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}>
                  {timeline.map((item, i) => (
                    <AnnRow
                      key={i}
                      time={item.time}
                      text={item.content}
                      highlighted={tlSel.has(item.time)}
                      noteOpen={tlNoteOpen.has(item.time)}
                      note={tlSel.get(item.time) ?? ''}
                      placeholder="이 구간에 메모 (선택)"
                      onToggleHighlight={() => toggleTl(item.time)}
                      onToggleNote={() => toggleTlNote(item.time)}
                      onNoteChange={(v) => setTlNote(item.time, v)}
                    />
                  ))}
                </div>
              </div>
            )}

            {errorMsg && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>{errorMsg}</div>
            )}

            {/* 생성 버튼 */}
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
              <Link size={15} /> {creating ? '생성 중…' : '링크 만들고 복사하기'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
