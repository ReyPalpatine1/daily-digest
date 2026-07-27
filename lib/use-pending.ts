'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// 서버를 호출하는 버튼의 진행 표시 공용 훅.
// - run(fn): 이미 진행 중이면 즉시 무시(중복 클릭 방지) → undefined 반환.
// - 표시는 200ms 지연 후에만 켠다. 그보다 빨리 끝나면 pending은 한 번도 true가 되지 않아 깜빡이지 않는다.
// - try/finally로 타이머 해제 + pending=false를 보장한다(실패·예외에도 원상 복구).
// - 언마운트 후에는 state를 건드리지 않고 타이머만 정리한다.
const PENDING_DELAY_MS = 200

export function usePending(): {
  pending: boolean
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
} {
  const [pending, setPending] = useState(false)
  const runningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (runningRef.current) return undefined
    runningRef.current = true
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (mountedRef.current) setPending(true)
    }, PENDING_DELAY_MS)
    try {
      return await fn()
    } finally {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      runningRef.current = false
      if (mountedRef.current) setPending(false)
    }
  }, [])

  return { pending, run }
}
