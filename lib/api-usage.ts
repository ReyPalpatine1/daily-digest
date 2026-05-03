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

  const { data: existing, error: selectError } = await supabaseAdmin
    .from('api_usage')
    .select('api_calls, input_tokens, output_tokens, tokens_used')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('service', service)
    .maybeSingle()

  if (selectError) {
    console.error('API 사용량 조회 오류:', selectError)
    return
  }

  if (existing) {
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
      console.error('API 사용량 업데이트 오류:', updateError)
    }
    return
  }

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

  if (insertError) {
    console.error('API 사용량 삽입 오류:', insertError)
  }
}
