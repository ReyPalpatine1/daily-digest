'use client'

// 공유 페이지(/s/[token]) 문제 신고 모달.
// 오버레이 구조·z-index는 HelpPopup/ShareSheet와 동일 규칙(fixed inset 0 / zIndex 200 / 배경 클릭 시 닫힘).
// 공유 페이지는 외부인 대상 한국어 고정 페이지라 t() 없이 문구를 직접 쓴다(페이지 본문과 동일).
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { X, CheckCircle } from 'lucide-react'
import { usePending } from '@/lib/use-pending'

type Reason = 'abuse' | 'privacy' | 'other'

const REASON_OPTIONS: { value: Reason; label: string }[] = [
  { value: 'abuse', label: '욕설 · 비방' },
  { value: 'privacy', label: '개인정보 노출' },
  { value: 'other', label: '기타' },
]

const DETAIL_MAX = 300

// 입력 섹션 라벨 — 라벨 줄 오른쪽에 카운터를 두므로 줄 자체는 flex.
const labelRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 8,
}
const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
}
const counterStyle: CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)',
}

// 사유 선택지 — 세로 목록. 의견 보내기(app/feedback)의 유형 선택과 같은 규칙을 쓴다.
function optionStyle(selected: boolean): CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left', boxSizing: 'border-box',
    padding: '11px 13px', borderRadius: 8, fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', marginBottom: 7,
    background: selected ? 'var(--text-primary)' : 'var(--bg-subtle)',
    color: selected ? 'var(--bg-card)' : 'var(--text-secondary)',
    border: selected ? 'none' : '0.5px solid var(--border)',
  }
}

export default function ReportModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [reason, setReason] = useState<Reason | null>(null)
  const [detail, setDetail] = useState('')
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  // 제출 진행 표시 — 200ms 이내 응답에선 켜지지 않는다(lib/use-pending.ts)
  const { pending: submitting, run: runSubmit } = usePending()

  const canSubmit = reason !== null && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setFailed(false)
    await runSubmit(async () => {
      const res = await fetch('/api/share-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, reason, detail: detail.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setDone(true)
        return
      }
      setFailed(true)
    }).catch(() => {
      setFailed(true)
    })
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
          width: '100%', maxWidth: 420,
          maxHeight: 'calc(100dvh - 28px)', overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          boxSizing: 'border-box',
          boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
        }}>
        {done ? (
          // 완료 화면 — 의견 보내기 성공 화면과 같은 구성(원형 아이콘 + 제목 + 안내 + 닫기).
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', background: 'var(--bg-subtle)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}>
              <CheckCircle size={30} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              신고가 접수되었습니다.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
              처리 결과는 별도로 안내되지 않습니다.
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                minWidth: 120, height: 42, borderRadius: 8, border: '0.5px solid var(--border)',
                background: 'transparent', color: 'var(--text-primary)', fontWeight: 500,
                fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
              }}>
              닫기
            </button>
          </div>
        ) : (
          <>
            {/* 헤더 */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 20,
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                문제 신고
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', fontFamily: 'inherit',
                }}>
                <X size={19} />
              </button>
            </div>

            {/* 신고 사유 — 단일 선택 */}
            <div style={{ marginBottom: 20 }}>
              <div style={labelRowStyle}>
                <span style={labelStyle}>신고 사유</span>
              </div>
              {REASON_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReason(opt.value)}
                  aria-pressed={reason === opt.value}
                  style={optionStyle(reason === opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>

            {/* 상세 내용(선택) */}
            <div style={{ marginBottom: 20 }}>
              <div style={labelRowStyle}>
                <span style={labelStyle}>상세 내용 (선택)</span>
                <span style={counterStyle}>{detail.length}/{DETAIL_MAX}</span>
              </div>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value.slice(0, DETAIL_MAX))}
                maxLength={DETAIL_MAX}
                placeholder="어떤 점이 문제인지 알려주세요"
                style={{
                  width: '100%', minHeight: 96, resize: 'vertical', boxSizing: 'border-box',
                  background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8,
                  padding: '11px 12px', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6,
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>

            {/* 신고하기 */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: '100%', height: 44, borderRadius: 8, border: 'none',
                background: 'var(--text-primary)', color: 'var(--bg-card)',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                cursor: canSubmit ? 'pointer' : 'default',
                opacity: canSubmit ? 1 : 0.5,
              }}>
              {submitting ? '처리 중…' : '신고하기'}
            </button>

            {failed && (
              <div style={{
                marginTop: 10, textAlign: 'center',
                fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
              }}>
                신고를 접수하지 못했어요. 잠시 후 다시 시도해 주세요.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
