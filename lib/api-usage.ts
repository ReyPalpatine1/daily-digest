import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

export type ApiService = 'gemini' | 'youtube' | 'supadata'

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
  outputTokens: number = 0,
  calls: number = 1
) {
  const date = todayKstDate()

  // atomic upsert via RPC (INSERT ... ON CONFLICT DO UPDATE)
  const { error: rpcError } = await supabaseAdmin.rpc('increment_api_usage', {
    p_user_id: userId,
    p_date: date,
    p_service: service,
    p_calls: calls,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
  })

  if (!rpcError) return

  // RPC가 아직 배포 안된 환경(또는 일시적 오류)에 대한 fallback:
  // insert-first → 23505면 update로 전환 (race-safe)
  console.warn('[api-usage] RPC 실패, fallback 사용:', rpcError.message)

  const { error: insertError } = await supabaseAdmin
    .from('api_usage')
    .insert({
      user_id: userId,
      date,
      service,
      api_calls: calls,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tokens_used: inputTokens + outputTokens,
    })

  if (!insertError) return

  if (insertError.code === '23505') {
    // 행이 이미 존재 → 기존 값을 읽어와 누적 update
    // (이 fallback 경로 자체도 race가 있을 수 있으나 RPC 부재 시 최선)
    const { data: existing } = await supabaseAdmin
      .from('api_usage')
      .select('api_calls, input_tokens, output_tokens')
      .eq('user_id', userId)
      .eq('date', date)
      .eq('service', service)
      .maybeSingle()

    if (!existing) {
      console.error('[api-usage] 23505 후 select 실패: 행 없음')
      return
    }

    const newInput = (existing.input_tokens ?? 0) + inputTokens
    const newOutput = (existing.output_tokens ?? 0) + outputTokens
    const { error: updateError } = await supabaseAdmin
      .from('api_usage')
      .update({
        api_calls: (existing.api_calls ?? 0) + calls,
        input_tokens: newInput,
        output_tokens: newOutput,
        tokens_used: newInput + newOutput,
      })
      .eq('user_id', userId)
      .eq('date', date)
      .eq('service', service)

    if (updateError) {
      console.error('[api-usage] fallback update 오류:', updateError)
    }
    return
  }

  console.error('[api-usage] insert 오류:', insertError)
}
