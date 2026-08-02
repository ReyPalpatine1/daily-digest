// 방문자 식별 해시 + 반복 집계 억제 판정.
// 목적은 "집계 정확도"이지 접근 차단이 아니다 → 판정이 실패하면 조용히 통과(=집계함)한다.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { createClient } from '@supabase/supabase-js'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워지므로 첫 사용 시점에 1회 lazy 생성한다. (lib/share-report.ts와 동일 패턴)
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

// 같은 방문자의 반복 행위를 한 번으로 묶는 창.
const DEDUPE_WINDOW_MS = 30 * 60_000

// 방문자 식별용 해시 — 원본 IP는 저장하지 않는다.
// Cloudflare Workers 호환을 위해 Node 'crypto'가 아닌 Web Crypto 사용(lib/trial-guard.ts와 동일).
// ※ 알고리즘을 바꾸면 기존 share_reports의 reporter_hash와 어긋나므로 변경 금지.
export async function hashVisitor(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// cf-connecting-ip(Cloudflare) 우선, 없으면 x-forwarded-for 첫 값.
// 둘 다 없으면 고정 문자열 — IP 미상 요청끼리 한 묶음으로 제한을 받는다.
export function resolveClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (xff) return xff
  return 'unknown'
}

// 서버 컴포넌트용 — Request 없이 next/headers의 Headers만 있을 때. 판정 규칙은 위와 동일.
export function resolveClientIpFromHeaders(h: Headers): string {
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (xff) return xff
  return 'unknown'
}

// 이 광고 클릭을 집계할지 판정. 같은 방문자가 같은 슬롯을 창 이내에 다시 누르면 false.
// dest는 비교에 넣지 않는다 — 같은 슬롯의 다른 배너도 30분에 1회로 묶는다.
// 조회 실패 시 true(=기존대로 집계).
export async function shouldCountAdClick(
  visitorHash: string,
  slot: string,
  _dest?: string | null
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
    const { data, error } = await getSupabase()
      .from('ad_clicks')
      .select('id')
      .eq('visitor_hash', visitorHash)
      .eq('slot', slot)
      .gte('clicked_at', since)
      .limit(1)
    if (error) {
      console.error('[visit-guard] 광고 클릭 중복 조회 실패(집계 진행):', error.message)
      return true
    }
    return (data?.length ?? 0) === 0
  } catch (e) {
    console.error('[visit-guard] 광고 클릭 중복 조회 예외(집계 진행):', e)
    return true
  }
}

// 이 공유 조회를 집계할지 판정. 같은 방문자가 같은 공유를 창 이내에 다시 열면 false.
// 집계하는 경우 share_views에 1행 남겨 다음 판정의 기준으로 삼는다.
// 조회·기록 실패 시 true(=기존대로 집계).
export async function shouldCountShareView(
  token: string,
  visitorHash: string
): Promise<boolean> {
  try {
    const supabase = getSupabase()
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
    const { data, error } = await supabase
      .from('share_views')
      .select('id')
      .eq('token', token)
      .eq('visitor_hash', visitorHash)
      .gte('viewed_at', since)
      .limit(1)
    if (error) {
      console.error('[visit-guard] 공유 조회 중복 확인 실패(집계 진행):', error.message)
      return true
    }
    if ((data?.length ?? 0) > 0) return false

    const { error: insertError } = await supabase
      .from('share_views')
      .insert({ token, visitor_hash: visitorHash })
    if (insertError) {
      // 기록 실패는 다음 방문이 다시 집계되는 정도의 영향 → 이번 조회는 그대로 집계한다.
      console.error('[visit-guard] 공유 조회 기록 실패(집계 진행):', insertError.message)
    }
    return true
  } catch (e) {
    console.error('[visit-guard] 공유 조회 중복 확인 예외(집계 진행):', e)
    return true
  }
}
