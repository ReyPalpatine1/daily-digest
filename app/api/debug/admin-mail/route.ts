import { NextResponse } from 'next/server'
import { resolveAdminRecipients, sendAdminBulkErrorEmail } from '@/lib/mailer'

export const maxDuration = 30

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const headerAuth = req.headers.get('authorization')
  if (headerAuth === `Bearer ${expected}`) return true
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  return queryToken === expected
}

function maskEmail(email: string): string {
  const trimmed = email.trim()
  const atIdx = trimmed.indexOf('@')
  if (atIdx <= 0) return '***'
  const local = trimmed.slice(0, atIdx)
  const domain = trimmed.slice(atIdx + 1)
  const visible = local.slice(0, Math.min(3, local.length))
  const stars = '*'.repeat(Math.max(local.length - visible.length, 1))
  return `${visible}${stars}@${domain}`
}

function maskList(raw: string | undefined): string | null {
  if (!raw) return null
  return raw
    .split(',')
    .map(item => maskEmail(item))
    .join(', ')
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const recipients = resolveAdminRecipients()

  return NextResponse.json({
    env: {
      ADMIN_EMAILS_set: !!process.env.ADMIN_EMAILS,
      ADMIN_EMAIL_set: !!process.env.ADMIN_EMAIL,
      ADMIN_EMAILS_masked: maskList(process.env.ADMIN_EMAILS),
      ADMIN_EMAIL_masked: maskList(process.env.ADMIN_EMAIL),
      CF_EMAIL_TOKEN_set: !!process.env.CF_EMAIL_TOKEN,
      MAIL_FROM_set: !!process.env.MAIL_FROM,
    },
    resolvedRecipients: recipients.map(maskEmail),
    recipientCount: recipients.length,
    willSend: recipients.length > 0,
  })
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const recipients = resolveAdminRecipients()
  const startedAt = new Date().toISOString()

  const fakeFailedItem = {
    channel: '디버그 채널',
    category: '디버그',
    emoji: '🧪',
    videoTitle: '[DEBUG] 관리자 메일 발송 검증 — 무시하세요',
    videoUrl: 'https://example.com/debug',
    errorInfo: 'DEBUG: /api/debug/admin-mail POST 호출로 발송된 테스트 메일',
    attempts: 1,
  }

  try {
    await sendAdminBulkErrorEmail(
      'DEBUG_USER',
      'debug@example.com',
      'debug-user-id',
      [fakeFailedItem],
      'manual'
    )
    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      recipientCount: recipients.length,
      resolvedRecipients: recipients.map(maskEmail),
      note: recipients.length === 0
        ? '⚠️ 수신자 0명 — 함수는 정상 종료했지만 실제 메일 발송 안 됨 (env var 확인 필요)'
        : '✅ 발송 호출 완료 — 메일함 확인',
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      recipientCount: recipients.length,
      resolvedRecipients: recipients.map(maskEmail),
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
