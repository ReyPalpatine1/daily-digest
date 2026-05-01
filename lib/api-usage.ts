import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

export async function logApiUsage(userId: string, apiCalls: number, tokensUsed: number) {
  const date = new Date().toISOString().slice(0, 10)

  const { data: existing, error: selectError } = await supabaseAdmin
    .from('api_usage')
    .select('api_calls, tokens_used')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()

  if (selectError) {
    console.error('API 사용량 조회 오류:', selectError)
    return
  }

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from('api_usage')
      .update({
        api_calls: existing.api_calls + apiCalls,
        tokens_used: existing.tokens_used + tokensUsed,
      })
      .eq('user_id', userId)
      .eq('date', date)

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
      api_calls: apiCalls,
      tokens_used: tokensUsed,
    })

  if (insertError) {
    console.error('API 사용량 삽입 오류:', insertError)
  }
}

export async function getApiUsageSummary() {
  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .select('user_id, date, api_calls, tokens_used')
    .order('date', { ascending: false })
    .limit(200)

  if (error) {
    console.error('API 사용량 요약 조회 오류:', error)
    return null
  }

  const totalCalls = (data ?? []).reduce((sum, row: any) => sum + (row.api_calls ?? 0), 0)
  const totalTokens = (data ?? []).reduce((sum, row: any) => sum + (row.tokens_used ?? 0), 0)

  return {
    totalCalls,
    totalTokens,
    rows: data ?? [],
  }
}
