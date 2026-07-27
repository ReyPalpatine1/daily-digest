'use client'

// 공유 페이지(/s/[token])의 영상 임베드 + 타임라인.
// 타임라인 항목 클릭 시 iframe src를 ?start=초&autoplay=1 로 교체해 해당 시각부터 재생하고,
// 플레이어가 화면에 보이도록 부드럽게 스크롤한다.
// (서버 컴포넌트인 페이지에서 videoId·watchUrl·타임라인(강조 포함)을 props로 받음)
// 서식은 열람기록과 통일 — 자체 카드 박스 없이 여백·라벨로만 구분한다(페이지가 카드 하나로 감싼다).
// children: 임베드와 타임라인 사이 자리(영상 제목 캡션). seek 상태를 공유해야 해
// 임베드와 타임라인이 한 컴포넌트에 있어야 하므로 그 사이를 슬롯으로 연다.
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'

const sectionLabelStyle: CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
  color: 'var(--text-muted)', marginBottom: 9,
}

// 공유자가 강조한 항목 하이라이트 — 노란 배경만(세로 바·체크 없음). 공유 페이지·시트와 동일.
const highlightStyle: CSSProperties = {
  background: 'rgba(255,205,0,0.20)',
  borderRadius: 6,
  margin: '0 -9px',
  padding: '7px 9px',
}

const rowBase: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8,
  width: '100%', textAlign: 'left',
  border: 'none', background: 'transparent',
  cursor: 'pointer', fontFamily: 'inherit', padding: 0,
}

const timeStyle: CSSProperties = {
  fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 44,
  fontVariantNumeric: 'tabular-nums', marginTop: 1,
  color: 'var(--text-primary)',
}

const toggleStyle: CSSProperties = {
  background: 'transparent', border: 'none', padding: 0,
  fontSize: 11.5, color: 'var(--text-muted)',
  cursor: 'pointer', fontFamily: 'inherit',
}

type TimelineItem = { time: string; content: string; seconds: number; active: boolean }

export default function ShareVideo({
  videoId, watchUrl, timeline, children,
}: {
  videoId: string
  watchUrl: string
  timeline: TimelineItem[]
  children?: React.ReactNode
}) {
  const base = `https://www.youtube.com/embed/${videoId}`
  const [src, setSrc] = useState(base)
  // 타임라인은 기본 접힘 — 펼치면 전체 목록, 접으면 강조 구간 한 줄만.
  const [expanded, setExpanded] = useState(false)
  const playerRef = useRef<HTMLDivElement>(null)

  const seek = (seconds: number) => {
    setSrc(`${base}?start=${seconds}&autoplay=1`)
    playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 접힘 상태에서 보여줄 강조 구간(첫 항목). 강조가 없으면 이 줄은 렌더하지 않는다.
  const firstActive = timeline.find(it => it.active) ?? null

  return (
    <>
      {/* 유튜브 임베드 */}
      <div ref={playerRef} style={{ borderRadius: 8, overflow: 'hidden' }}>
        <iframe
          src={src}
          title={watchUrl}
          style={{ width: '100%', aspectRatio: '16 / 9', border: 0, display: 'block' }}
          allowFullScreen
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
        />
      </div>

      {/* 영상 제목 캡션 자리 (페이지에서 주입) */}
      {children}

      {/* 타임라인 — 클릭 시 해당 시각부터 재생 */}
      {timeline.length > 0 && (
        <div style={{ marginTop: 18, marginBottom: 22 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
          }}>
            <div style={sectionLabelStyle}>타임라인</div>
            <button type="button" onClick={() => setExpanded(v => !v)} style={toggleStyle}>
              {expanded ? '접기' : '전체 타임라인 보기'}
            </button>
          </div>

          {/* 접힘: 강조 구간 한 줄만 (펼치면 목록 안에 표시되므로 감춘다) */}
          {!expanded && firstActive && (
            <button
              type="button"
              onClick={() => seek(firstActive.seconds)}
              style={{ ...rowBase, ...highlightStyle, alignItems: 'center' }}>
              <span style={{
                fontSize: 11, fontWeight: 600, flexShrink: 0,
                color: 'var(--text-primary)',
              }}>
                여기부터
              </span>
              <span style={timeStyle}>{firstActive.time}</span>
              <span style={{
                fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {firstActive.content}
              </span>
            </button>
          )}

          {/* 펼침: 전체 목록 (강조 항목은 노란 배경) */}
          {expanded && timeline.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => seek(item.seconds)}
              style={{
                ...rowBase,
                ...(item.active ? highlightStyle : {}),
                marginBottom: 6,
              }}>
              <span style={timeStyle}>{item.time}</span>
              <span style={{
                fontSize: 13, lineHeight: 1.6,
                color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}>
                {item.content}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
