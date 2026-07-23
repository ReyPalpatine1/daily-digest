'use client'

// 공유 페이지(/s/[token])의 영상 임베드 + 타임라인.
// 타임라인 항목 클릭 시 iframe src를 ?start=초&autoplay=1 로 교체해 해당 시각부터 재생한다.
// (서버 컴포넌트인 페이지에서 videoId·watchUrl·타임라인(강조 포함)을 props로 받음)
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Clock, ExternalLink } from 'lucide-react'

const cardStyle: CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 14,
  padding: 18,
}

const sectionLabelStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
  color: 'var(--text-tertiary)', marginBottom: 10,
}

type TimelineItem = { time: string; content: string; seconds: number; active: boolean }

export default function ShareVideo({
  videoId, watchUrl, timeline,
}: {
  videoId: string
  watchUrl: string
  timeline: TimelineItem[]
}) {
  const base = `https://www.youtube.com/embed/${videoId}`
  const [src, setSrc] = useState(base)

  const seek = (seconds: number) => {
    setSrc(`${base}?start=${seconds}&autoplay=1`)
  }

  return (
    <>
      {/* 유튜브 임베드 (요약 아래) */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <iframe
          src={src}
          title="YouTube video player"
          style={{ width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 8, display: 'block' }}
          allowFullScreen
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
        />
        {/* 임베드 차단 영상 대비 — 유튜브 딥링크 유지 */}
        <div style={{ padding: '10px 16px' }}>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, color: 'var(--text-tertiary)', textDecoration: 'none',
            }}
          >
            <ExternalLink size={11} /> 유튜브에서 보기
          </a>
        </div>
      </div>

      {/* 타임라인 — 클릭 시 해당 시각부터 재생 */}
      {timeline.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionLabelStyle}>
            <Clock size={12} /> 타임라인
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {timeline.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => seek(item.seconds)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '7px 10px', borderRadius: 6,
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit', width: '100%',
                  background: item.active ? 'rgba(255,205,0,0.18)' : 'transparent',
                  boxShadow: item.active ? 'inset 2px 0 0 var(--text-primary)' : 'none',
                }}
              >
                <span style={{
                  fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 34,
                  fontVariantNumeric: 'tabular-nums',
                  color: item.active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}>
                  {item.time}
                </span>
                <span style={{
                  fontSize: 13, lineHeight: 1.55,
                  color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: item.active ? 600 : 400,
                }}>
                  {item.content}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
