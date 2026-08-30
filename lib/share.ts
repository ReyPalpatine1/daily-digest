// 공유 링크(shared_summaries) 관련 로직.
// 주 흐름(수집·요약·발송)을 절대 막지 않도록 모든 함수는 내부에서 try-catch 하고 실패는 로깅만.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { shouldCountShareView } from './visit-guard'

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

// 토큰 형식 방어 — generateShareToken이 항상 0-9a-z 12자를 만들고 기존 DB 토큰도 전부 12자다.
// 공유 페이지·신고 API·관리자 조치가 모두 이 함수를 쓴다(복붙 금지 — 규칙이 갈라지면 방어가 뚫린다).
export function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-z]{12}$/.test(token)
}

// 공유 항목 강조 데이터. keyPoints[i]=핵심포인트 배열 인덱스, summary=요약 문장 원문,
// timeline[time]=타임라인 시각(식별자). 항목별 메모 기능은 폐지(note 제거).
// summary는 인덱스가 아닌 문장 원문(text)만 저장한다 — 요약 재생성·분리 로직이 바뀌어도
// 인덱스가 어긋나지 않도록. 세 배열 합계 20개 제한.
export type ShareAnnotations = {
  keyPoints: { i: number; text: string }[]
  summary: { text: string }[]
  timeline: { time: string; text: string }[]
}

// 클라이언트가 보낸 annotations를 방어적으로 검증(필드 타입 확인, 세 배열 합계 20개 제한).
// 유효 항목이 하나도 없으면 null(→ 컬럼 null 저장). DB 조회값 재검증에도 재사용.
function validateAnnotations(input: unknown): ShareAnnotations | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as { keyPoints?: unknown; summary?: unknown; timeline?: unknown }

  const kp: ShareAnnotations['keyPoints'] = []
  if (Array.isArray(obj.keyPoints)) {
    for (const it of obj.keyPoints) {
      if (!it || typeof it !== 'object') continue
      const o = it as { i?: unknown; text?: unknown }
      if (typeof o.i !== 'number' || !Number.isFinite(o.i)) continue
      if (typeof o.text !== 'string') continue
      kp.push({ i: Math.trunc(o.i), text: o.text })
    }
  }

  const sum: ShareAnnotations['summary'] = []
  if (Array.isArray(obj.summary)) {
    for (const it of obj.summary) {
      if (!it || typeof it !== 'object') continue
      const o = it as { text?: unknown }
      if (typeof o.text !== 'string' || !o.text.trim()) continue
      sum.push({ text: o.text })
    }
  }

  const tl: ShareAnnotations['timeline'] = []
  if (Array.isArray(obj.timeline)) {
    for (const it of obj.timeline) {
      if (!it || typeof it !== 'object') continue
      const o = it as { time?: unknown; text?: unknown }
      if (typeof o.time !== 'string' || !o.time.trim()) continue
      if (typeof o.text !== 'string') continue
      tl.push({ time: o.time, text: o.text })
    }
  }

  // 세 배열 합계 20개 제한 (keyPoints → summary → timeline 순으로 슬롯 배분).
  const limitedKp = kp.slice(0, 20)
  let remaining = 20 - limitedKp.length
  const limitedSum = sum.slice(0, Math.max(0, remaining))
  remaining -= limitedSum.length
  const limitedTl = tl.slice(0, Math.max(0, remaining))
  if (limitedKp.length === 0 && limitedSum.length === 0 && limitedTl.length === 0) return null
  return { keyPoints: limitedKp, summary: limitedSum, timeline: limitedTl }
}

// 공유 레코드 생성 → token 반환. 실패 시 throw (호출부 API 라우트에서 500 처리).
export async function createShare(params: {
  videoId: string
  sharedBy: string
  comment?: string
  highlightTime?: string
  annotations?: unknown
  showName: boolean
}): Promise<string> {
  // comment: 100자 truncate, 빈 문자열은 null.
  const comment = params.comment?.trim() ? params.comment.trim().slice(0, 100) : null
  const annotations = validateAnnotations(params.annotations)
  // 하위 호환: 기존 공유 페이지가 highlight_time으로 첫 재생 지점을 잡으므로,
  // timeline 강조 첫 항목의 time을 highlight_time에도 함께 저장한다.
  // timeline 강조가 없으면 구 클라이언트의 highlightTime 파라미터("m:ss")로 폴백, 그것도 없으면 null.
  const highlightTime = annotations && annotations.timeline.length > 0
    ? annotations.timeline[0].time
    : (params.highlightTime && /^\d{1,2}:\d{2}$/.test(params.highlightTime) ? params.highlightTime : null)

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
      annotations,
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

// ── 공개 공유 페이지(/s/[token])용 조회 ──────────────────────────────
// 공유 페이지 메모 라벨이 고정 문구('공유자 메모')가 되어 공유자 이름은 조회하지 않는다.
// 채널명(channels.alias)도 사용자 별칭이라 공개 페이지에 부적절 — 원 채널명은 임베드에 표시된다.
// show_name 컬럼은 DB에 남겨두되(기존 데이터 보존) 코드에서는 사용하지 않는다.
export type ShareData = {
  expired: boolean
  blocked?: boolean // 운영 정책상 비공개 처리(blocked_at) — 만료보다 우선
  comment: string | null
  highlightTime: string | null
  annotations: ShareAnnotations | null
  video: {
    videoId: string
    title: string
    description: string | null
  } | null
  summary: {
    tldr: string | null
    summary: string | null
    keyPoints: string[]
    timeline: { time: string; content: string }[]
    summaryBasis: string | null
  } | null
}

// shared_summaries 단건 조회 — 한 요청 안에서 generateMetadata와 페이지 본문이 각각
// getShareByToken을 부르므로 같은 토큰을 두 번 조회하게 된다. React cache()로 요청 단위 메모이제이션.
// ※ cache()는 인자가 같을 때만 재사용되므로 token 외의 인자(countView·visitorHash 등)를 받지 말 것.
// ※ 요청 컨텍스트 밖(크론 등)에서는 React가 캐시 없이 그대로 실행하므로 동작은 동일하다.
const getShareRow = cache(async (token: string) => {
  // 조회 실패(error)는 기존과 같이 무시 — data가 null이면 호출부가 "없는 공유"로 처리한다.
  const { data } = await getSupabase()
    .from('shared_summaries')
    .select('token, video_id, comment, highlight_time, annotations, expires_at, blocked_at')
    .eq('token', token)
    .maybeSingle()
  return data
})

// 토큰으로 공유 정보 + 영상 + 요약 조회. 없으면 null, 만료면 { expired: true }만 채워 반환.
// countView: true일 때만 view_count +1 (best-effort — 페이지 본문 렌더에서만, 봇/메타 요청은 skip).
export async function getShareByToken(
  token: string,
  // visitorHash: 있으면 같은 방문자의 짧은 간격 재방문을 조회수에서 제외한다(없으면 기존대로 +1).
  opts?: { countView?: boolean; visitorHash?: string | null }
): Promise<ShareData | null> {
  try {
    const supabase = getSupabase()
    const shareRow = await getShareRow(token)
    if (!shareRow) return null

    const share = shareRow as {
      video_id: string
      comment: string | null
      highlight_time: string | null
      annotations: unknown
      expires_at: string | null
      blocked_at: string | null
    }

    // 차단(비공개 처리)은 만료 판정보다 우선.
    if (share.blocked_at) {
      return {
        blocked: true,
        expired: false,
        comment: null, highlightTime: null, annotations: null,
        video: null, summary: null,
      }
    }

    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      return {
        expired: true,
        comment: null, highlightTime: null, annotations: null,
        video: null, summary: null,
      }
    }

    // view_count +1 — 컬럼 조회/갱신 모두 best-effort(실패해도 페이지 렌더에 영향 없음).
    // 동시 접속 시 레이스로 일부 누락 가능하나 통계용이라 허용.
    // 방문자 해시가 있으면 창(30분) 이내 재방문은 집계에서 제외. 해시가 없거나 판정이
    // 실패하면 shouldCountShareView가 true를 돌려주므로 기존대로 +1 된다.
    const countView = opts?.countView
      ? (opts.visitorHash ? await shouldCountShareView(token, opts.visitorHash) : true)
      : false

    if (countView) {
      try {
        const { data: vc } = await supabase
          .from('shared_summaries').select('view_count').eq('token', token).maybeSingle()
        const cur = (vc as { view_count?: number } | null)?.view_count
        if (typeof cur === 'number') {
          await supabase.from('shared_summaries').update({ view_count: cur + 1 }).eq('token', token)
        }
      } catch {
        // 무시
      }
    }

    // 영상 + 요약 병렬 조회 (요약은 ko 우선, 없으면 임의 1행)
    const [videoRes, summaryRes] = await Promise.all([
      supabase.from('videos')
        .select('video_id, title, description')
        .eq('video_id', share.video_id)
        .maybeSingle(),
      supabase.from('video_summaries')
        .select('locale, tldr, summary, key_points, timeline, summary_basis')
        .eq('video_id', share.video_id)
        .limit(10),
    ])

    const videoRow = videoRes.data as {
      video_id: string; title: string | null; description: string | null
    } | null

    type SummaryRow = {
      locale: string | null
      tldr: string | null
      summary: string | null
      key_points: unknown
      timeline: unknown
      summary_basis: string | null
    }
    const summaryRows = (summaryRes.data ?? []) as SummaryRow[]
    const picked = summaryRows.find(r => r.locale === 'ko') ?? summaryRows[0] ?? null

    // JSONB 필드 방어적 정규화 (배열 아니거나 항목 형식이 다르면 버림)
    const keyPoints = Array.isArray(picked?.key_points)
      ? (picked!.key_points as unknown[]).filter((p): p is string => typeof p === 'string')
      : []
    const timeline = Array.isArray(picked?.timeline)
      ? (picked!.timeline as unknown[]).filter(
          (it): it is { time: string; content: string } =>
            !!it && typeof it === 'object' &&
            typeof (it as { time?: unknown }).time === 'string' &&
            typeof (it as { content?: unknown }).content === 'string'
        )
      : []

    return {
      expired: false,
      comment: share.comment,
      highlightTime: share.highlight_time,
      annotations: validateAnnotations(share.annotations),
      video: videoRow
        ? {
            videoId: videoRow.video_id,
            title: videoRow.title ?? '(제목 없음)',
            description: videoRow.description,
          }
        : null,
      summary: picked
        ? {
            tldr: picked.tldr?.trim() || null,
            summary: picked.summary?.trim() || null,
            keyPoints,
            timeline,
            summaryBasis: picked.summary_basis,
          }
        : null,
    }
  } catch (e) {
    console.error('[share] 공유 조회 실패:', e)
    return null
  }
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

  // 조회수 중복 판정용 기록(share_views)은 판정 창(30분)보다 넉넉한 24시간만 보관한다.
  // 별도 try/catch — 여기서 실패해도 위의 공유 정리 결과에는 영향이 없다.
  try {
    const viewCutoff = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data, error } = await getSupabase()
      .from('share_views')
      .delete()
      .lt('viewed_at', viewCutoff)
      .select('id')
    if (error) {
      console.error(`[share] 공유 조회 기록 정리 실패: ${error.message}`)
    } else {
      console.log(`[share] 공유 조회 기록 정리: ${data?.length ?? 0}건 삭제`)
    }
  } catch (e) {
    console.error('[share] 공유 조회 기록 정리 예외:', e)
  }

  // 신고 기록(share_reports)은 처리·반복 위반 확인 목적으로 1년만 보관한다(개인정보처리방침 제3조 6항).
  // 신고 접수 시점의 공유 메모 원문을 담고 있어 기간이 지나면 남겨둘 근거가 없다.
  // 별도 try/catch — 여기서 실패해도 앞뒤 정리에는 영향이 없다.
  try {
    const reportCutoff = new Date(Date.now() - 365 * 24 * 3600_000).toISOString()
    const { data, error } = await getSupabase()
      .from('share_reports')
      .delete()
      .lt('created_at', reportCutoff)
      .select('id')
    if (error) {
      console.error(`[share] 신고 기록 정리 실패: ${error.message}`)
    } else {
      console.log(`[share] 신고 기록 정리: ${data?.length ?? 0}건 삭제`)
    }
  } catch (e) {
    console.error('[share] 신고 기록 정리 예외:', e)
  }

  // 광고 클릭(ad_clicks)은 90일이 지나면 식별 정보만 지운다(개인정보처리방침 제3조 7항).
  // ★ 행을 지우지 않는다 — slot·source·is_bot·clicked_at은 광고 성과 집계에 계속 쓰이므로,
  //   행째 지우면 과거 광고 성과가 통째로 사라진다.
  // visitor_hash is not null 조건이 반드시 있어야 이미 정리된 행을 매번 다시 갱신하지 않는다.
  try {
    const adCutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString()
    const { data, error } = await getSupabase()
      .from('ad_clicks')
      .update({ visitor_hash: null, user_agent: null })
      .lt('clicked_at', adCutoff)
      .not('visitor_hash', 'is', null)
      .select('id')
    if (error) {
      console.error(`[share] 광고 클릭 식별정보 정리 실패: ${error.message}`)
    } else {
      console.log(`[share] 광고 클릭 식별정보 정리: ${data?.length ?? 0}건 익명화`)
    }
  } catch (e) {
    console.error('[share] 광고 클릭 식별정보 정리 예외:', e)
  }
}
