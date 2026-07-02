// 무료 체험 재악용 방지 유틸.
// 해시는 Cloudflare Workers 호환을 위해 Web Crypto(crypto.subtle)만 사용(Node 'crypto' import 금지).

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
