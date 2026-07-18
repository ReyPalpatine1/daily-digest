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
