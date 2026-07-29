// 공유 페이지(/s/[token]) 문제 신고(share_reports) 로직.
// share_reports는 RLS 켜짐·정책 없음 = service_role 전용이므로 서버에서만 import.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 클라이언트 컴포넌트에서 import 금지.
import { createClient } from '@supabase/supabase-js'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워지므로 첫 사용 시점에 1회 lazy 생성한다. (lib/share.ts와 동일 패턴)
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

export type ShareReportReason = 'abuse' | 'privacy' | 'other'

// 관리자 알림(이메일·텔레그램)에서 함께 쓰는 한글 라벨.
export const SHARE_REPORT_REASON_LABEL: Record<ShareReportReason, string> = {
  abuse: '욕설 · 비방',
  privacy: '개인정보 노출',
  other: '기타',
}

// 도배 방지 기준 — 같은 신고자(reporter_hash)에 대해
//  · 같은 공유(token)를 10분 내 다시 신고 → 거부
//  · 1시간 내 5건을 넘는 신고 → 거부
const DUPLICATE_WINDOW_MS = 10 * 60_000
const BURST_WINDOW_MS = 60 * 60_000
const BURST_LIMIT = 5

// 신고 접수. 성공 { ok: true } / 도배 차단 { ok: false, reason }.
// 사유 코드: 'duplicate'(같은 공유 재신고) | 'rate_limited'(단시간 다발) | 'insert_failed'
export async function createShareReport(params: {
  token: string
  reason: ShareReportReason
  detail?: string
  reporterHash: string
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = getSupabase()

  // detail: 300자 truncate, 빈 문자열이면 null.
  const detail = params.detail?.trim() ? params.detail.trim().slice(0, 300) : null

  // ── 도배 방지 ────────────────────────────────────────────────
  // 조회 실패(에러)는 접수를 막지 않는다 — 신고가 유실되는 편보다 중복 접수가 낫다.
  const now = Date.now()
  const { data: dup, error: dupError } = await supabase
    .from('share_reports')
    .select('id')
    .eq('reporter_hash', params.reporterHash)
    .eq('token', params.token)
    .gt('created_at', new Date(now - DUPLICATE_WINDOW_MS).toISOString())
    .limit(1)
  if (dupError) {
    console.error('[share-report] 중복 신고 조회 실패:', dupError.message)
  } else if (dup && dup.length > 0) {
    return { ok: false, reason: 'duplicate' }
  }

  const { count, error: burstError } = await supabase
    .from('share_reports')
    .select('*', { count: 'exact', head: true })
    .eq('reporter_hash', params.reporterHash)
    .gt('created_at', new Date(now - BURST_WINDOW_MS).toISOString())
  if (burstError) {
    console.error('[share-report] 신고 건수 조회 실패:', burstError.message)
  } else if (typeof count === 'number' && count >= BURST_LIMIT) {
    return { ok: false, reason: 'rate_limited' }
  }

  // ── 스냅샷 ──────────────────────────────────────────────────
  // 원본 공유가 삭제되거나 공유자가 탈퇴해도 근거가 남도록 신고 시점 값을 함께 저장한다.
  // 공유가 이미 없으면 스냅샷 필드는 null로 두고 신고 자체는 접수한다.
  let videoId: string | null = null
  let sharedBy: string | null = null
  let commentSnapshot: string | null = null
  try {
    const { data: shareRow } = await supabase
      .from('shared_summaries')
      .select('video_id, shared_by, comment')
      .eq('token', params.token)
      .maybeSingle()
    if (shareRow) {
      const row = shareRow as { video_id: string | null; shared_by: string | null; comment: string | null }
      videoId = row.video_id ?? null
      sharedBy = row.shared_by ?? null
      commentSnapshot = row.comment ?? null
    }
  } catch (e) {
    console.error('[share-report] 공유 스냅샷 조회 예외:', e)
  }

  // status / created_at 은 DB 기본값 사용
  const { error: insertError } = await supabase.from('share_reports').insert({
    token: params.token,
    video_id: videoId,
    shared_by: sharedBy,
    comment_snapshot: commentSnapshot,
    reason: params.reason,
    detail,
    reporter_hash: params.reporterHash,
  })
  if (insertError) {
    console.error('[share-report] 신고 저장 실패:', insertError.message)
    return { ok: false, reason: 'insert_failed' }
  }

  return { ok: true }
}

export type ShareReportContext = {
  sharedBy: string | null
  commentSnapshot: string | null
  videoTitle: string | null
}

// 관리자 알림용 부가 정보 — 공유자·메모 원문에 영상 제목을 더해 돌려준다.
// videos는 별도 조회로 붙인다(PostgREST 임베드 대신 — lib/share.ts getShareByToken과 같은 방식).
// best-effort: 실패해도 null 필드로 돌려주고 알림 자체는 막지 않는다.
export async function fetchShareReportContext(token: string): Promise<ShareReportContext> {
  const empty: ShareReportContext = { sharedBy: null, commentSnapshot: null, videoTitle: null }
  try {
    const supabase = getSupabase()
    const { data: shareRow } = await supabase
      .from('shared_summaries')
      .select('video_id, shared_by, comment')
      .eq('token', token)
      .maybeSingle()
    if (!shareRow) return empty

    const row = shareRow as { video_id: string | null; shared_by: string | null; comment: string | null }
    let videoTitle: string | null = null
    if (row.video_id) {
      const { data: videoRow } = await supabase
        .from('videos')
        .select('title')
        .eq('video_id', row.video_id)
        .maybeSingle()
      videoTitle = (videoRow as { title?: string | null } | null)?.title ?? null
    }
    return {
      sharedBy: row.shared_by ?? null,
      commentSnapshot: row.comment ?? null,
      videoTitle,
    }
  } catch (e) {
    console.error('[share-report] 신고 컨텍스트 조회 실패:', e)
    return empty
  }
}
