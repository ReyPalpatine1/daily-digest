'use client'

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { X, Copy, Check, MessageCircle, Share2, Link, RefreshCw } from 'lucide-react'
import { splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'

type TFn = (key: string, params?: Record<string, string | number>) => string

type Props = {
  videoId: string
  videoTitle: string // 현재 미사용(호출부 유지용으로 시그니처에 잔존)
  tldr?: string // 열람기록과 동일하게 상단에 표시(강조 대상 아님)
  keyPoints: string[]
  summary: string // 요약 섹션 제거로 미사용(호출부 유지용으로 시그니처에 잔존)
  timeline: { time: string; content: string }[]
  userName: string // 이름 표시 토글 제거로 미사용(시그니처만 유지)
  t: TFn
  onClose: () => void
}

// 섹션 라벨 — 열람기록과 동일한 스타일.
const sectionLabelStyle: CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)',
  fontWeight: 600, letterSpacing: 0.6, marginBottom: 9,
}

// 핵심 포인트 한 줄 렌더 — 열람기록과 동일 경로.
// 새 형식은 상세 요약과 같은 `**앵커.**` 마커 → 볼드 변환만.
// 마커가 없는 과거 형식('앵커 — 부연')만 splitKeyPointPrefix로 앞부분을 굵게.
function KeyPointText({ text }: { text: string }) {
  const segs = splitBoldSegments(text)
  const legacy = segs.some(s => s.bold) ? null : splitKeyPointPrefix(text)
  return (
    <>
      {legacy?.prefix && (
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {legacy.prefix}{' — '}
        </span>
      )}
      {(legacy ? splitBoldSegments(legacy.rest) : segs).map((seg, i) =>
        seg.bold
          ? <strong key={i} style={{ color: 'var(--text-primary)' }}>{seg.text}</strong>
          : <span key={i}>{seg.text}</span>
      )}
    </>
  )
}

// 강조 가능한 한 줄 항목(핵심 포인트·타임라인 공용). 줄 클릭 = 강조 토글(다중).
// 강조 표시는 배경만 — 체크 아이콘·세로 바 없음.
// 좌우 -9px로 박스/카드 여백보다 살짝 넓게 칠해 항목 단위임을 드러낸다.
function AnnRow(props: { time?: string; highlighted: boolean; onToggle: () => void; children: ReactNode }) {
  const { time, highlighted, onToggle, children } = props
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        margin: '0 -9px', padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
        background: highlighted ? 'rgba(255,205,0,0.20)' : 'transparent',
        marginBottom: 5,
      }}>
      {time !== undefined && (
        <span style={{
          fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 42,
          fontVariantNumeric: 'tabular-nums', marginTop: 1,
          color: highlighted ? 'var(--text-primary)' : 'var(--text-tertiary)',
        }}>
          {time}
        </span>
      )}
      <span style={{
        fontSize: 13, lineHeight: 1.6, flex: 1,
        color: highlighted ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        {children}
      </span>
    </div>
  )
}

// 요약 공유 시트 — 열람기록과 같은 화면 구성(펼침). 상단 메모 + tldr·핵심 포인트·타임라인.
// 상세 요약은 공유 페이지에 표시하지 않으므로 강조 대상에서 제외.
// 항목 클릭으로 다중 강조. 링크 생성 후에도 위 내용은 유지하고 하단 버튼만 전환.
// ※ 문구는 우선 한국어 하드코딩(i18n 키 추가는 백로그 — 수정 파일 범위 제한).
export default function ShareSheet({ videoId, tldr, keyPoints, timeline, t, onClose }: Props) {
  const [comment, setComment] = useState('')
  const [kpSel, setKpSel] = useState<Set<number>>(new Set())   // 핵심 포인트 인덱스
  const [tlSel, setTlSel] = useState<Set<string>>(new Set())   // 타임라인 시각(time)
  const [creating, setCreating] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  // 링크를 만든 시점의 입력값 스냅샷. 현재 값과 다를 때만 "새 링크 만들기"를 노출한다
  // (항상 노출하면 기존 링크가 무효가 되는 것처럼 오해할 수 있음).
  const [createdSig, setCreatedSig] = useState<string | null>(null)
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

  // 메모 + 강조 선택을 하나의 문자열로 요약 — 생성 시점 값과 비교해 변경 여부를 판정한다.
  const inputSig = JSON.stringify({
    comment: comment.trim(),
    kp: [...kpSel].sort((a, b) => a - b),
    tl: [...tlSel].sort(),
  })
  const changedSinceCreate = createdSig !== null && createdSig !== inputSig

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
      const annTimeline = timeline
        .filter((x) => tlSel.has(x.time))
        .map((x) => ({ time: x.time, text: x.content }))
      // summary 강조는 폐지 — 구조 유지를 위해 항상 빈 배열로 전송(lib/share.ts 검증 그대로)
      const annotations = { keyPoints: annKeyPoints, summary: [], timeline: annTimeline }

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
        setCreatedSig(inputSig) // 이 값으로 만들었음 → 버튼 숨김(이후 수정하면 다시 노출)
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

  const hasSelectable = keyPoints.length > 0 || timeline.length > 0

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
          width: '100%', maxWidth: 560,
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

        {/* (c) 안내 + 구분선 + (d) 요약 내용(열람기록과 동일 구성) */}
        {(tldr || hasSelectable) && (
          <div>
            {hasSelectable && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 18 }}>
                  강조할 부분을 선택해주세요.
                </div>
                <div style={{ height: 1, background: 'rgba(128,128,128,0.16)', marginBottom: 18 }} />
              </>
            )}

            {/* tldr — 둥근 바 + 본문. 강조 대상이 아니므로 클릭 불가 */}
            {tldr && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div style={{
                  width: 3, borderRadius: 2,
                  background: 'var(--text-primary)', flexShrink: 0,
                }} />
                <div style={{
                  fontSize: 14.5, fontWeight: 600,
                  color: 'var(--text-primary)', lineHeight: 1.6,
                }}>
                  {tldr}
                </div>
              </div>
            )}

            {keyPoints.length > 0 && (
              <div style={{
                background: 'var(--bg-subtle)', borderRadius: 8,
                padding: '14px 15px', marginBottom: 20,
              }}>
                <div style={sectionLabelStyle}>{t('history.keyPoints')}</div>
                {keyPoints.map((text, i) => (
                  <AnnRow
                    key={i}
                    highlighted={kpSel.has(i)}
                    onToggle={() => toggleNum(kpSel, setKpSel, i)}>
                    <KeyPointText text={text} />
                  </AnnRow>
                ))}
              </div>
            )}

            {timeline.length > 0 && (
              <div>
                <div style={sectionLabelStyle}>{t('history.timeline')}</div>
                {timeline.map((item, i) => (
                  <AnnRow
                    key={i}
                    time={item.time}
                    highlighted={tlSel.has(item.time)}
                    onToggle={() => toggleStr(tlSel, setTlSel, item.time)}>
                    {item.content}
                  </AnnRow>
                ))}
              </div>
            )}
          </div>
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
            {/* 새 링크 만들기(내용을 수정했을 때만) + 카카오톡 */}
            <div style={{ display: 'flex', gap: 8 }}>
              {changedSinceCreate && (
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
                  <RefreshCw size={15} /> {creating ? '생성 중…' : '수정한 내용으로 새 링크 만들기'}
                </button>
              )}
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
