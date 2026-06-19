// 발송 상태 관리 (멱등성 + 동시성 방어 + 죽은 프로세스 복구).
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버(라우트 핸들러)에서만 import.
//    (lib/supabase.ts는 브라우저/anon 클라이언트라 send_log 쓰기에 부적합)
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { dateKey, nowUtc } from './time'

// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 처리 시점에 채워짐)
// service client를 최상단이 아니라 첫 사용 시점에 lazy 생성한다.
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return _supabase
}

// 기존 `supabase.from(...)` 사용처를 그대로 두기 위해 Proxy로 인터페이스 유지.
const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

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

// ── 속보 발송 멱등성 (user_id, video_id) ─────────────────────
// 정각과 동일한 3단계 상태 + 5분 타임아웃 패턴. send_log type='breaking'.
export async function tryStartBreaking(userId: string, videoId: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('send_log')
    .select('id, status, started_at')
    .eq('user_id', userId)
    .eq('type', 'breaking')
    .eq('video_id', videoId)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'sent') return false
    if (existing.status === 'sending') {
      const elapsed = Date.now() - new Date(existing.started_at).getTime()
      if (elapsed < STALE_MINUTES * 60 * 1000) return false
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

  // partial unique index (user_id, video_id) WHERE type='breaking'가 동시성 방어
  const { error } = await supabase.from('send_log').insert({
    user_id: userId,
    type: 'breaking',
    video_id: videoId,
    status: 'sending',
  })
  if (error) return false
  return true
}

export async function markBreakingSent(userId: string, videoId: string): Promise<void> {
  await supabase
    .from('send_log')
    .update({ status: 'sent', completed_at: nowUtc().toISOString() })
    .eq('user_id', userId)
    .eq('type', 'breaking')
    .eq('video_id', videoId)
}

export async function markBreakingFailed(userId: string, videoId: string, error: string): Promise<void> {
  await supabase
    .from('send_log')
    .update({ status: 'failed', error_message: error.slice(0, 500), completed_at: nowUtc().toISOString() })
    .eq('user_id', userId)
    .eq('type', 'breaking')
    .eq('video_id', videoId)
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
