import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

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
