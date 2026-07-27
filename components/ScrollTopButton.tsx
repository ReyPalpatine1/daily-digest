'use client'

// "맨 위로" 버튼 — 열람기록(대시보드)에서 쓰던 구현을 그대로 공용화한 것.
// 일정량(400px) 이상 스크롤하면 우하단에 원형 버튼으로 노출된다.
// enabled=false면 스크롤 위치와 무관하게 렌더하지 않는다(대시보드의 탭 조건용).
import { useEffect, useState } from 'react'

const SHOW_AFTER_PX = 400

export default function ScrollTopButton({
  label,
  enabled = true,
}: {
  label: string
  enabled?: boolean
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!enabled || !show) return null

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={label}
      title={label}
      style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 60,
        width: 40, height: 40, borderRadius: '50%',
        background: 'var(--bg-card)', border: '0.5px solid var(--border)',
        color: 'var(--text-tertiary)', fontSize: 16,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontFamily: 'inherit',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
      ↑
    </button>
  )
}
