// 관리자 오류 적재 (error_log 테이블).
// 주 흐름(수집·요약·발송)을 절대 막지 않도록 모든 함수는 내부에서 try-catch 하고 실패는 로깅만.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { createClient } from '@supabase/supabase-js'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워지므로 첫 사용 시점에 1회 lazy 생성한다. (video-pool.ts와 동일 패턴)
function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
}
type ServiceClient = ReturnType<typeof makeServiceClient>
let _supabase: ServiceClient | null = null
function getSupabase(): ServiceClient {
  if (!_supabase) _supabase = makeServiceClient()
  return _supabase
}

export type ErrorSource = 'summary' | 'digest' | 'breaking' | 'collect' | 'preview'

export type ErrorLogEntry = {
  source: ErrorSource
  videoId?: string | null
  videoTitle?: string | null
  channelId?: string | null // channelName 미지정 시 alias 조회에 사용
  channelName?: string | null
  failReason?: string | null // no_source | temporary | live | send_error 등
  failDetail?: string | null
  dedupe?: boolean // true면 같은 video_id+fail_reason이 이미 있으면 skip (반복 감지 소음 방지)
}

// 오류 1건 적재. 실패해도 throw하지 않는다 (호출부 흐름 보호).
export async function logErrorEvent(entry: ErrorLogEntry): Promise<void> {
  try {
    const supabase = getSupabase()

    // 중복 적재 방지 (같은 video_id + fail_reason)
    if (entry.dedupe && entry.videoId && entry.failReason) {
      const { data: existing } = await supabase
        .from('error_log')
        .select('id')
        .eq('video_id', entry.videoId)
        .eq('fail_reason', entry.failReason)
        .limit(1)
      if (existing?.length) return
    }

    // 채널명 보정: 미지정이면 videos.channel_id → channels.alias 조회 (best-effort)
    let channelName = entry.channelName ?? null
    if (!channelName) {
      let channelId = entry.channelId ?? null
      if (!channelId && entry.videoId) {
        const { data: v } = await supabase
          .from('videos')
          .select('channel_id')
          .eq('video_id', entry.videoId)
          .maybeSingle()
        channelId = (v as any)?.channel_id ?? null
      }
      if (channelId) {
        const { data: ch } = await supabase
          .from('channels')
          .select('alias')
          .eq('channel_id', channelId)
          .limit(1)
        channelName = (ch?.[0] as any)?.alias ?? channelId
      }
    }

    const { error } = await supabase.from('error_log').insert({
      source: entry.source,
      video_id: entry.videoId ?? null,
      video_title: entry.videoTitle ?? null,
      channel_name: channelName,
      fail_reason: entry.failReason ?? null,
      fail_detail: entry.failDetail ? entry.failDetail.slice(0, 1000) : null,
    })
    if (error) console.error(`[error-log] 적재 실패: ${error.message}`)
  } catch (e) {
    console.error('[error-log] 적재 예외:', e)
  }
}

// 30일 지난 오류 기록 정리 — digests 30일 정리(delete_old_digests)와 같은 지점에서 호출.
export async function cleanupOldErrorLogs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
    const { error } = await getSupabase().from('error_log').delete().lt('occurred_at', cutoff)
    if (error) console.error(`[error-log] 30일 정리 실패: ${error.message}`)
  } catch (e) {
    console.error('[error-log] 30일 정리 예외:', e)
  }
}
