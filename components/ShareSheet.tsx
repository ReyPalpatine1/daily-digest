'use client'

import { useState } from 'react'
import { X, Copy, Check, MessageCircle, Share2 } from 'lucide-react'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  videoId: string
  videoTitle: string // 현재 미사용(호출부 유지용으로 시그니처에 잔존)
  timeline: { time: string; content: string }[]
  userName: string
  t: TFn
  onClose: () => void
}

// 요약 공유 시트 — HelpPopup/TrialPopup 모달 뼈대 미러링(오버레이 zIndex 200, 중앙 카드, CSS 변수만).
// ※ 문구는 우선 한국어 하드코딩(i18n 키 추가는 백로그 — 수정 파일 범위 제한).
export default function ShareSheet({ videoId, timeline, userName, t, onClose }: Props) {
  const [comment, setComment] = useState('')
  const [highlightTime, setHighlightTime] = useState<string | null>(null)
  const [showName, setShowName] = useState(true)
  const [creating, setCreating] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [kakaoNotice, setKakaoNotice] = useState(false)

  const create = async () => {
    if (creating) return
    setCreating(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          comment: comment.trim() || undefined,
          highlightTime: highlightTime ?? undefined,
          showName,
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
    color: 'var(--text-tertiary)', marginBottom: 8,
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
          /* ── 작성 폼 ── */
          <>
            {/* 메모 */}
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

            {/* 이름 표시 토글 */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
              fontSize: 13, color: 'var(--text-secondary)',
            }}>
              <input
                type="checkbox"
                checked={showName}
                onChange={(e) => setShowName(e.target.checked)}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
              />
              내 이름({userName}) 표시
            </label>

            {/* 핵심 구간 선택 — 타임라인 목록에서 직접 선택(형광펜), timeline 있을 때만 */}
            {timeline.length > 0 && (
              <div>
                <div style={{ ...sectionLabel, marginBottom: 3 }}>핵심 구간 선택</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  받는 사람이 여기부터 보게 됩니다 (선택)
                </div>
                <div style={{
                  maxHeight: 150, overflowY: 'auto',
                  border: '0.5px solid var(--border-light)', borderRadius: 8, padding: 4,
                }}>
                  {timeline.map((item, i) => {
                    const active = highlightTime === item.time
                    return (
                      <div
                        key={i}
                        onClick={() => setHighlightTime(active ? null : item.time)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                          background: active ? 'rgba(255,205,0,0.18)' : 'transparent',
                          boxShadow: active ? 'inset 2px 0 0 var(--text-primary)' : 'none',
                        }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 34,
                          fontVariantNumeric: 'tabular-nums',
                          color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        }}>
                          {item.time}
                        </span>
                        <span style={{
                          fontSize: 12, lineHeight: 1.45, flex: 1,
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        }}>
                          {item.content}
                        </span>
                        {active && <Check size={12} style={{ flexShrink: 0, color: 'var(--text-primary)' }} />}
                      </div>
                    )
                  })}
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
                padding: '11px 14px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: 'var(--bg-card)',
                fontSize: 13.5, fontWeight: 600, cursor: creating ? 'default' : 'pointer',
                fontFamily: 'inherit', opacity: creating ? 0.6 : 1,
              }}>
              {creating ? '생성 중…' : '공유 링크 만들기'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
