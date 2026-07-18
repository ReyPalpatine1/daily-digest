// 공유 링크(shared_summaries) 관련 로직.
// 주 흐름(수집·요약·발송)을 절대 막지 않도록 모든 함수는 내부에서 try-catch 하고 실패는 로깅만.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { createClient } from '@supabase/supabase-js'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워지므로 첫 사용 시점에 1회 lazy 생성한다. (error-log.ts와 동일 패턴)
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

// 공유 토큰 생성 — URL 안전 문자(0-9a-z) 12자. Cloudflare Workers 호환을 위해
// Node crypto 대신 Web Crypto(전역 crypto) 사용.
export function generateShareToken(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

// 공유 레코드 생성 → token 반환. 실패 시 throw (호출부 API 라우트에서 500 처리).
export async function createShare(params: {
  videoId: string
  sharedBy: string
  comment?: string
  highlightTime?: string
  showName: boolean
}): Promise<string> {
  // comment: 100자 truncate, 빈 문자열은 null. highlightTime: "m:ss" 형식만 허용, 그 외 null.
  const comment = params.comment?.trim() ? params.comment.trim().slice(0, 100) : null
  const highlightTime =
    params.highlightTime && /^\d{1,2}:\d{2}$/.test(params.highlightTime) ? params.highlightTime : null

  const supabase = getSupabase()
  // 토큰 충돌(PK 중복) 확률은 무시 가능 수준이지만, 만약 충돌하면 재생성해 1회만 재시도.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = generateShareToken()
    const { error } = await supabase.from('shared_summaries').insert({
      token,
      video_id: params.videoId,
      shared_by: params.sharedBy,
      comment,
      highlight_time: highlightTime,
      show_name: params.showName,
      // expires_at은 테이블 기본값 사용
    })
    if (!error) return token
    // 23505 = unique_violation (token PK 충돌) → 재시도. 그 외는 즉시 실패.
    if (error.code !== '23505' || attempt === 1) {
      throw new Error(`shared_summaries insert 실패: ${error.message}`)
    }
  }
  throw new Error('shared_summaries insert 실패: 토큰 생성 재시도 초과') // 도달 불가 (타입 안전용)
}

// 만료된 지 7일 지난 공유 링크 물리 삭제 — digests 30일 정리(delete_old_digests)와 같은 지점에서 호출.
// 만료 직후 바로 지우지 않고 7일 유예: 만료 안내 페이지 노출 기간 확보.
export async function cleanupExpiredShares(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
    const { error } = await getSupabase().from('shared_summaries').delete().lt('expires_at', cutoff)
    if (error) console.error(`[share] 만료 공유 정리 실패: ${error.message}`)
  } catch (e) {
    console.error('[share] 만료 공유 정리 예외:', e)
  }
}
