// 발송 상태 관리 (멱등성 + 동시성 방어 + 죽은 프로세스 복구).
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버(라우트 핸들러)에서만 import.
//    (lib/supabase.ts는 브라우저/anon 클라이언트라 send_log 쓰기에 부적합)
import { createClient } from '@supabase/supabase-js'
import { dateKey, nowUtc } from './time'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// sending 상태가 이 시간을 넘기면 죽은 프로세스로 간주하고 재시도
const STALE_MINUTES = 5

// 정각 발송 시작 시도 (멱등성 + 동시실행 방어).
// true  → 발송 진행 가능
// false → 이미 완료(sent)이거나 다른 프로세스가 처리 중(sending, 5분 이내)
export async function tryStartScheduled(userId: string): Promise<boolean> {
  const today = dateKey(nowUtc()) // KST 날짜 키

  const { data: existing } = await supabase
    .from('send_log')
    .select('id, status, started_at')
    .eq('user_id', userId)
    .eq('type', 'scheduled')
    .eq('send_date', today)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'sent') return false // 이미 완료
    if (existing.status === 'sending') {
      const elapsed = Date.now() - new Date(existing.started_at).getTime()
      if (elapsed < STALE_MINUTES * 60 * 1000) return false // 살아있음 → skip
      // 5분 초과 = 죽은 것 → sending 갱신 후 재시도
      await supabase
        .from('send_log')
        .update({ status: 'sending', started_at: nowUtc().toISOString() })
        .eq('id', existing.id)
      return true
    }
    // failed → 재시도
    await supabase
      .from('send_log')
      .update({ status: 'sending', started_at: nowUtc().toISOString(), error_message: null })
      .eq('id', existing.id)
    return true
  }

  // 신규 insert — partial unique index(user_id, send_date)가 동시성 방어
  const { error } = await supabase.from('send_log').insert({
    user_id: userId,
    type: 'scheduled',
    send_date: today,
    status: 'sending',
  })

  // unique 충돌 = 다른 cron이 먼저 시작 → skip
  if (error) return false
  return true
}

// 정각 발송 완료 처리
export async function markScheduledSent(userId: string): Promise<void> {
  const today = dateKey(nowUtc())
  await supabase
    .from('send_log')
    .update({ status: 'sent', completed_at: nowUtc().toISOString() })
    .eq('user_id', userId)
    .eq('type', 'scheduled')
    .eq('send_date', today)
}

// 정각 발송 실패 처리 (다음 cron 슬롯에서 재시도됨)
export async function markScheduledFailed(userId: string, error: string): Promise<void> {
  const today = dateKey(nowUtc())
  await supabase
    .from('send_log')
    .update({ status: 'failed', error_message: error.slice(0, 500), completed_at: nowUtc().toISOString() })
    .eq('user_id', userId)
    .eq('type', 'scheduled')
    .eq('send_date', today)
}

// 수동("지금 실행하기") 발송 기록 — 통계용, 멱등성과 무관(unique 제약 없음).
// 실패해도 발송 흐름을 막지 않도록 best-effort.
export async function logManualSend(userId: string): Promise<void> {
  try {
    await supabase.from('send_log').insert({
      user_id: userId,
      type: 'manual',
      status: 'sent',
      completed_at: nowUtc().toISOString(),
    })
  } catch (e) {
    console.error('[send-guard] manual 로그 기록 실패:', e)
  }
}
