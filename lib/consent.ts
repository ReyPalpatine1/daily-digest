// 첫 로그인 동의(이용약관·개인정보처리방침·만 14세 이상) 서버 판정.
// - Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 env는 함수 안에서 읽는다.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// 동의 당시 약관 버전 — 이용약관 시행일과 맞춘다(profiles.terms_version에 기록).
export const TERMS_VERSION = '2026-11-24'

// 동의 전 계정이면 403 { error: 'consent_required' }, 조회 실패면 500, 동의했으면 null.
// 조회 실패를 "동의함"으로 넘기지 않는다(동의 없이 기능이 열리는 구멍 방지).
export async function consentRequiredResponse(userId: string): Promise<NextResponse | null> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const { data, error } = await client
    .from('profiles')
    .select('terms_agreed_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[consent] 동의 여부 조회 실패:', userId, error.message)
    return NextResponse.json({ error: 'consent_check_failed' }, { status: 500 })
  }
  if (!data?.terms_agreed_at) {
    return NextResponse.json({ error: 'consent_required' }, { status: 403 })
  }
  return null
}
