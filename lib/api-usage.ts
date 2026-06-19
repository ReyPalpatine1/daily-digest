import { createClient } from '@supabase/supabase-js'

// Cloudflare Workers는 모듈 로드 시점엔 process.env가 비어 있고 "요청 처리 시점"에
// 채워진다. 최상단에서 createClient를 호출하면 키가 undefined가 되어
// "supabaseKey is required"로 터지므로, 첫 사용 시점에 1회 lazy 생성한다. (Vercel도 동일 동작)
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
const supabaseAdmin: ServiceClient = new Proxy({} as ServiceClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export type ApiService = 'gemini' | 'youtube' | 'supadata'

// 공유 풀 수집/요약처럼 특정 사용자가 없는 시스템 작업의 사용량 귀속용 계정.
// api_usage.user_id는 uuid NOT NULL(profiles FK 없음)이라 zero-uuid를 그대로 사용.
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

function todayKstDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const map = Object.fromEntries(
    parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  ) as Record<string, string>
  return `${map.year}-${map.month}-${map.day}`
}

export async function logApiUsage(
  userId: string,
  service: ApiService,
  inputTokens: number = 0,
  outputTokens: number = 0
): Promise<void> {
  const date = todayKstDate()
  try {
    const { error } = await supabaseAdmin.rpc('increment_api_usage', {
      p_user_id: userId,
      p_service: service,
      p_date: date,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    })
    if (error) {
      console.error('[api-usage] RPC 실패 (무시):', error.message)
    }
  } catch (e) {
    console.error('[api-usage] 예외 (무시):', e)
  }
}
