'use client'

import { useState, useEffect } from 'react'

export default function Test() {
  const [count, setCount] = useState(0)
  const [touchCount, setTouchCount] = useState(0)
  const [info, setInfo] = useState('')

  useEffect(() => {
    setInfo(`${navigator.userAgent}\n\n화면크기: ${window.innerWidth} x ${window.innerHeight}\n\n터치지원: ${('ontouchstart' in window) ? 'YES' : 'NO'}`)
  }, [])

  return (
    <div style={{ padding: 20, background: '#0a0a0a', color: '#f0f0f0', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h2 style={{ color: '#e8ff47', marginBottom: 20 }}>iOS 15 호환 테스트</h2>

      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setCount(c => c + 1)}
          style={{ padding: '20px 40px', fontSize: 18, background: '#e8ff47', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700 }}>
          onClick 테스트 ({count})
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button onTouchEnd={() => setTouchCount(c => c + 1)}
          style={{ padding: '20px 40px', fontSize: 18, background: '#4da6ff', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700 }}>
          onTouchEnd 테스트 ({touchCount})
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <a href="https://www.google.com" style={{ color: '#47ffb2', fontSize: 18 }}>일반 링크 (구글로 이동)</a>
      </div>

      <pre style={{ marginTop: 20, padding: 12, background: '#222', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {info}
      </pre>
    </div>
  )
}