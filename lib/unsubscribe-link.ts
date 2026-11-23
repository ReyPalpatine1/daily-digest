import { createHmac, timingSafeEqual } from 'crypto'

// 광고 수신거부 서명 링크 (로그인 불필요).
// 토큰 = 회원 ID + 용도 + HMAC-SHA256(UNSUBSCRIBE_SECRET) — DB 미저장(stateless), 만료 없음
// (언제 받은 메일의 링크든 동작해야 한다). 서명·검증 원리는 lib/telegram-link.ts와 같다.
// ★ 시크릿·토큰 원문은 로그에 남기지 않는다.

export type UnsubscribePurpose = 'ads'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 시크릿은 요청 처리 시점에 읽는다(Cloudflare 호환). 기본값을 두지 않는다 — 없으면 null.
export function getUnsubscribeSecret(): string | null {
  const s = process.env.UNSUBSCRIBE_SECRET
  return s && s.length > 0 ? s : null
}

function sign(userId: string, purpose: UnsubscribePurpose, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}:${purpose}`).digest('base64url')
}

// 토큰 형식: {userId}.{purpose}.{sig}
export function buildUnsubscribeToken(userId: string, purpose: UnsubscribePurpose, secret: string): string {
  return `${userId}.${purpose}.${sign(userId, purpose, secret)}`
}

// 검증 성공 시 userId, 아니면 null(형식 오류·용도 불일치·서명 불일치·시크릿 없음).
export function verifyUnsubscribeToken(token: string | null | undefined, purpose: UnsubscribePurpose): string | null {
  const secret = getUnsubscribeSecret()
  if (!secret || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, p, sig] = parts
  if (!UUID_RE.test(userId) || p !== purpose) return null
  const expected = Buffer.from(sign(userId, purpose, secret))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return userId
}
