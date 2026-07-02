// 무료 체험 재악용 방지 유틸.
// 해시는 Cloudflare Workers 호환을 위해 Web Crypto(crypto.subtle)만 사용(Node 'crypto' import 금지).

import type { SupabaseClient, User } from '@supabase/supabase-js'

// 이메일을 소문자 정규화 후 SHA-256 해시(hex). 원문은 저장하지 않는다.
export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const data = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type IdentityLike = { provider?: string; id?: string }
type UserLike = {
  identities?: IdentityLike[] | null
  user_metadata?: { sub?: string; provider_id?: string } | null
}

// Supabase user 객체에서 소셜 로그인 고유 ID 추출(현재 Google sub 기준, 타 플랫폼 확장 대비).
export function getPlatformId(user: UserLike): string | null {
  const googleIdentity = user.identities?.find((i) => i.provider === 'google')
  return (
    googleIdentity?.id ??
    user.user_metadata?.sub ??
    user.user_metadata?.provider_id ??
    null
  )
}

export type TrialProfile = {
  plan: string | null
  plan_status: string | null
  trial_used: boolean | null
  plan_expires_at: string | null
}

export type TrialEligibility = {
  eligible: boolean
  profile: TrialProfile | null
  emailHash: string | null
  platformId: string | null
}

// 체험 가능 여부 판정 — profiles.trial_used에 더해 trial_history(탈퇴 후에도 남는 이력) 대조.
// 조회만 수행(DB 변경 없음). GET(조회 API)과 POST(체험 시작)가 공유한다.
export async function checkTrialEligibility(
  serviceClient: SupabaseClient,
  user: User
): Promise<TrialEligibility> {
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan, plan_status, trial_used, plan_expires_at')
    .eq('id', user.id)
    .single()

  const emailHash = user.email ? await hashEmail(user.email) : null
  const platformId = getPlatformId(user)

  if (profile?.trial_used) {
    return { eligible: false, profile, emailHash, platformId }
  }

  // profiles가 신규 생성되어 trial_used=false여도 과거 체험 이력이 있으면 차단.
  const orConditions: string[] = []
  if (emailHash) orConditions.push(`email_hash.eq.${emailHash}`)
  if (platformId) orConditions.push(`platform_id.eq.${platformId}`)

  if (orConditions.length > 0) {
    const { data: history, error: historyError } = await serviceClient
      .from('trial_history')
      .select('id')
      .or(orConditions.join(','))
      .limit(1)
    if (historyError) {
      console.error('[trial-guard] trial_history 조회 실패:', historyError.message)
    }
    if (history && history.length > 0) {
      return { eligible: false, profile, emailHash, platformId }
    }
  }
  // emailHash/platformId 둘 다 null이면 이력 대조는 건너뛰고 trial_used만 신뢰.
  return { eligible: true, profile, emailHash, platformId }
}
