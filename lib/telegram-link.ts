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

// Compact signed code: 16-byte UUID + 4-byte expiry (uint32 BE, seconds)
// → base64url(20 bytes) + '.' + 6-char sig. 총 ~34자 (Telegram start 파라미터 64자 이내).
export function buildLinkCode(userId: string, secret: string): string {
  const uuidHex = userId.replace(/-/g, '')
  const uuidBuf = Buffer.from(uuidHex, 'hex')
  const expiry = Math.floor(Date.now() / 1000) + LINK_CODE_TTL_SECONDS
  const expiryBuf = Buffer.allocUnsafe(4)
  expiryBuf.writeUInt32BE(expiry, 0)
  const payload = Buffer.concat([uuidBuf, expiryBuf])
  const payloadB64 = payload.toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 6)
  return `${payloadB64}.${sig}`
}

// 코드 검증: 서명 일치(위조 방지) + 만료 확인. 유효하면 user_id 반환.
export function decodeLinkCode(code: string, secret: string): { userId: string; expired: boolean } | null {
  const parts = code.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts
  let payload: Buffer
  try {
    payload = Buffer.from(payloadB64, 'base64url')
  } catch {
    return null
  }
  if (payload.length !== 20) return null
  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 6)
  if (sig !== expectedSig) return null
  const uuidHex = payload.slice(0, 16).toString('hex')
  const userId = `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`
  const expiry = payload.readUInt32BE(16)
  const expired = Math.floor(Date.now() / 1000) > expiry
  return { userId, expired }
}
