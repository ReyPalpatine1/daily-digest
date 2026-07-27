'use client'

// 공유 페이지(/s/[token])의 영상 임베드 + 타임라인.
// 블록 순서: 임베드 → 영상 제목 캡션 → 강조 구간 줄 → 토글 → (펼침 시) 전체 타임라인.
// 항목 클릭 시 iframe src를 ?start=초&autoplay=1 로 교체해 그 시각부터 재생하고,
// 플레이어가 화면에 보이도록 부드럽게 스크롤한다.
// 서식은 열람기록과 통일 — 자체 카드 박스 없이 여백으로만 구분한다(페이지가 카드 하나로 감싼다).
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// 목록 컨테이너 — 좌우 -9px로 강조 배경이 살짝 넓게 칠해진다.
// 접힘(강조 구간)·펼침(전체 목록) 두 상태가 같은 규칙을 써야 토글해도 글자가 움직이지 않는다.
const listStyle: CSSProperties = {
  marginLeft: -9,
  marginRight: -9,
}

type TimelineItem = { time: string; content: string; seconds: number; active: boolean }

// 타임라인 한 줄 — 접힘·펼침 두 상태가 공유한다.
// 강조 행은 배경색과 내용 글자색만 달라지고, padding·fontSize·minWidth는 동일하다(위치 어긋남 방지).
function TimelineRow({ item, onSelect }: { item: TimelineItem; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        padding: '7px 9px', borderRadius: 6, marginBottom: 4,
        background: item.active ? 'rgba(255,205,0,0.20)' : 'transparent',
      }}>
      <span style={{
        display: 'inline-block', minWidth: 44,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600, fontSize: 13,
        color: 'var(--text-primary)',
      }}>
        {item.time}
      </span>
      <span style={{
        fontSize: 13, lineHeight: 1.5,
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        {item.content}
      </span>
    </button>
  )
}

export default function ShareVideo({
  videoId, videoTitle, watchUrl, timeline,
}: {
  videoId: string
  videoTitle: string
  watchUrl: string
  timeline: TimelineItem[]
}) {
  const base = `https://www.youtube.com/embed/${videoId}`
  const [src, setSrc] = useState(base)
  // 타임라인은 기본 접힘 — 접으면 강조 구간만, 펼치면 전체 목록.
  const [expanded, setExpanded] = useState(false)
  const playerRef = useRef<HTMLDivElement>(null)

  const seek = (seconds: number) => {
    setSrc(`${base}?start=${seconds}&autoplay=1`)
    playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 공유자가 강조한 구간 전부(접힘 상태에서 각각 한 줄로 표시).
  const activeItems = timeline.filter(it => it.active)

  return (
    <>
      {/* 유튜브 임베드 */}
      <div ref={playerRef} style={{ borderRadius: 8, overflow: 'hidden' }}>
        <iframe
          src={src}
          title={videoTitle}
          style={{ width: '100%', aspectRatio: '16 / 9', border: 0, display: 'block' }}
          allowFullScreen
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
        />
      </div>

      {/* 영상 제목 캡션 — 임베드가 차단된 경우의 폴백(채널명은 표시하지 않음) */}
      <a
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', marginTop: 7,
          fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4,
          textDecoration: 'none',
        }}>
        {videoTitle}
      </a>

      {timeline.length > 0 && (
        <div style={{ marginTop: 14, marginBottom: 20 }}>
          {/* 강조 구간 — 펼치면 목록 안에 표시되므로 감춘다(중복 방지) */}
          {!expanded && activeItems.length > 0 && (
            <div style={listStyle}>
              {activeItems.map((item, i) => (
                <TimelineRow key={i} item={item} onSelect={() => seek(item.seconds)} />
              ))}
            </div>
          )}

          {/* 토글 — 왼쪽 정렬 텍스트 버튼 */}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginTop: !expanded && activeItems.length > 0 ? 6 : 0,
              background: 'transparent', border: 'none', padding: 0,
              fontSize: 11.5, color: 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {expanded ? '접기' : '전체 타임라인'}
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {/* 펼침: 전체 목록 (강조 항목은 노란 배경) */}
          {expanded && (
            <div style={{ ...listStyle, marginTop: 10 }}>
              {timeline.map((item, i) => (
                <TimelineRow key={i} item={item} onSelect={() => seek(item.seconds)} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
