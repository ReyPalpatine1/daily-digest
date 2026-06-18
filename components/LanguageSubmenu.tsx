'use client'

import { useRef, useState } from 'react'
import { localeOptions, type Locale } from '@/lib/i18n/translations'

// 설정 드롭다운 안의 "언어" 선택 메뉴.
// 데스크탑: 항목 오른쪽으로 뜨는 플라이아웃(오른쪽 공간 부족 시 왼쪽).
// 모바일: 옆으로 뜨면 잘리므로 인라인 아코디언으로 폴백.
// 언어 목록/동작/폴백은 AppHeader·dashboard 공용 — UI(펼침 방식)만 담당.
export function LanguageSubmenu({
  locale,
  label,
  itemStyle,
  isMobile,
  onSelect,
}: {
  locale: Locale
  label: string
  itemStyle: React.CSSProperties
  isMobile: boolean
  onSelect: (l: Locale) => void
}) {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'right' | 'left'>('right')
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 오른쪽 공간이 부족하면 왼쪽으로 펼침 (잘림 방지)
  const decideSide = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSide(rect.right + 170 > window.innerWidth ? 'left' : 'right')
  }

  const langButtons = localeOptions.map(opt => (
    <button key={opt.code}
      style={{ ...itemStyle, paddingLeft: isMobile ? 24 : 12 }}
      onClick={() => { setOpen(false); onSelect(opt.code) }}>
      <span style={{ flex: 1 }}>{opt.label}</span>
      {locale === opt.code && <span style={{ color: 'var(--accent)' }}>✓</span>}
    </button>
  ))

  // 모바일: 인라인 아코디언
  if (isMobile) {
    return (
      <>
        <button style={itemStyle} onClick={() => setOpen(o => !o)}>
          <span style={{ flex: 1 }}>{label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{open ? '▾' : '▸'}</span>
        </button>
        {open && langButtons}
      </>
    )
  }

  // 데스크탑: 옆으로 뜨는 플라이아웃 (설정 드롭다운과 동일한 패널 스타일)
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => { decideSide(); setOpen(true) }}
      onMouseLeave={() => setOpen(false)}>
      <button ref={triggerRef} style={itemStyle}
        onClick={() => { decideSide(); setOpen(o => !o) }}>
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>▸</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: -6, zIndex: 70,
          ...(side === 'right' ? { left: '100%' } : { right: '100%' }),
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          padding: 6,
          minWidth: 150,
        }}>
          {langButtons}
        </div>
      )}
    </div>
  )
}

export default LanguageSubmenu
