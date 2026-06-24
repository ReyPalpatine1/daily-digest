import { createHmac } from 'crypto'

// 텔레그램 원탭 연결용 "서명 코드" 공통 모듈.
// link-code(발급)와 webhook(검증)이 반드시 같은 로직을 쓰도록 단일 소스로 통일.
// DB 미저장 — user_id+만료시각을 HMAC 서명해 코드 자체에 담는다(stateless).

const DEFAULT_LINK_SECRET = 'default-link-secret'
export const LINK_CODE_TTL_SECONDS = 10 * 60 // 10분

// 서명 secret. process.env를 호출 시점(요청 처리 중)에 읽어야 Cloudflare에서 안전.
export function getLinkSecret(): string {
  return process.env.TELEGRAM_LINK_SECRET ?? DEFAULT_LINK_SECRET
}

// Hex-encoded signed code — only [0-9a-f], Telegram deep-link start parameter safe ([A-Za-z0-9_]).
// Layout: payload hex (20 bytes → 40 chars) + sig hex (12 chars) = 52 chars total.
// Telegram allows up to 64 chars; base64url '-' and '.' separator were being stripped.
export function buildLinkCode(userId: string, secret: string): string {
  const uuidHex = userId.replace(/-/g, '')
  const uuidBuf = Buffer.from(uuidHex, 'hex')
  const expiry = Math.floor(Date.now() / 1000) + LINK_CODE_TTL_SECONDS
  const expiryBuf = Buffer.allocUnsafe(4)
  expiryBuf.writeUInt32BE(expiry, 0)
  const payload = Buffer.concat([uuidBuf, expiryBuf])
  const payloadHex = payload.toString('hex')
  const sig = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 12)
  return `${payloadHex}${sig}`
}

// 코드 검증: 서명 일치(위조 방지) + 만료 확인. 유효하면 user_id 반환.
export function decodeLinkCode(code: string, secret: string): { userId: string; expired: boolean } | null {
  // 40-char payload hex + 12-char sig hex = 52 chars
  if (code.length !== 52) return null
  const payloadHex = code.slice(0, 40)
  const sig = code.slice(40)
  let payload: Buffer
  try {
    payload = Buffer.from(payloadHex, 'hex')
  } catch {
    return null
  }
  if (payload.length !== 20) return null
  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 12)
  if (sig !== expectedSig) return null
  const uuidHex = payload.slice(0, 16).toString('hex')
  const userId = `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`
  const expiry = payload.readUInt32BE(16)
  const expired = Math.floor(Date.now() / 1000) > expiry
  return { userId, expired }
}
