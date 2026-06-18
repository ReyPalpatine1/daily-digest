import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import { SummaryResult } from './gemini'
import { VideoItem } from './youtube'
import { et, type EmailLocale } from './i18n/email-translations'
import {
  buildDigestHtml,
  buildBreakingHtml,
  buildWelcomeHtml,
} from './email-templates'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

// 이메일 발송 로그 기록용 (서버 전용 service client)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export type EmailLogType = 'digest' | 'breaking' | 'error' | 'welcome'

// 발송 결과를 email_logs에 기록. 실패해도 메일 발송 흐름을 막지 않음.
async function logEmailResult(
  userId: string | null,
  email: string,
  type: EmailLogType,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    await supabase.from('email_logs').insert({
      user_id: userId,
      email,
      type,
      status: success ? 'success' : 'failed',
      error_message: errorMessage ?? null,
    })
  } catch (e) {
    console.error('이메일 로그 기록 실패:', e)
  }
}

type DigestItem = {
  channel: string
  category: string
  emoji: string
  video: VideoItem
  summary: SummaryResult
}

// locale 정규화 — 잘못된 값이 들어와도 'ko' 폴백
function normalizeLocale(locale?: string | null): EmailLocale {
  if (locale === 'en' || locale === 'zh' || locale === 'ja') return locale
  return 'ko'
}

// 메일 제목 등 날짜 표기용 로케일 코드
const dateLocaleByEmailLocale: Record<EmailLocale, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
}

export async function sendDigestEmail(
  to: string,
  userName: string,
  items: DigestItem[],
  locale: string | null = 'ko',
  userId: string | null = null
): Promise<void> {
  const lc = normalizeLocale(locale)
  const date = new Date().toLocaleDateString(dateLocaleByEmailLocale[lc], {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  try {
    await transporter.sendMail({
      from: `"Daily Digest" <${process.env.GMAIL_USER}>`,
      to,
      subject: et(lc, 'digest.subject', { date }),
      html: buildDigestHtml(items, userName, lc, to),
    })
    await logEmailResult(userId, to, 'digest', true)
  } catch (e) {
    await logEmailResult(userId, to, 'digest', false, String(e))
    throw e
  }
}

// 어제 새 영상이 없던 날 보내는 안내 메일 (notify_when_empty=true인 경우만).
export async function sendEmptyDigestEmail(
  to: string,
  userName: string,
  locale: string | null = 'ko',
  userId: string | null = null
): Promise<void> {
  const lc = normalizeLocale(locale)
  const date = new Date().toLocaleDateString(dateLocaleByEmailLocale[lc], {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const html = `
    <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
      <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 16px">${et(lc, 'digest.greeting')}</h1>
      <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 8px">${userName}님,</p>
      <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 24px">${et(lc, 'digest.emptyBody')}</p>
      <p style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:16px;margin:0">
        ${et(lc, 'digest.footer')} · ${et(lc, 'digest.sentTo', { email: to })}
      </p>
    </div>
  `

  try {
    await transporter.sendMail({
      from: `"Daily Digest" <${process.env.GMAIL_USER}>`,
      to,
      subject: et(lc, 'digest.emptySubject', { date }),
      html,
    })
    await logEmailResult(userId, to, 'digest', true)
  } catch (e) {
    await logEmailResult(userId, to, 'digest', false, String(e))
    throw e
  }
}

export async function sendBreakingAlert(
  to: string,
  userName: string,
  item: DigestItem,
  locale: string | null = 'ko',
  userId: string | null = null
): Promise<void> {
  const lc = normalizeLocale(locale)
  try {
    await transporter.sendMail({
      from: `"Daily Digest" <${process.env.GMAIL_USER}>`,
      to,
      subject: et(lc, 'breaking.subject', { title: item.video.title }),
      html: buildBreakingHtml(item, userName, lc, to),
    })
    await logEmailResult(userId, to, 'breaking', true)
  } catch (e) {
    await logEmailResult(userId, to, 'breaking', false, String(e))
    throw e
  }
}

export async function sendWelcomeEmail(
  to: string,
  locale: string | null = 'ko'
): Promise<void> {
  const lc = normalizeLocale(locale)
  await transporter.sendMail({
    from: `"Daily Digest" <${process.env.GMAIL_USER}>`,
    to,
    subject: et(lc, 'welcome.subject'),
    html: buildWelcomeHtml(lc),
  })
}

type FailedItem = {
  channel: string
  category: string
  emoji: string
  videoTitle: string
  videoUrl: string
  errorInfo: string
  attempts?: number
}

export type DigestTrigger = 'manual' | 'cron' | 'breaking'

const triggerLabel: Record<DigestTrigger, string> = {
  manual: '테스트 (지금 실행하기)',
  cron: '정시 자동 발송',
  breaking: '실시간 속보 감지',
}

export function resolveAdminRecipients(): string[] {
  const fromEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(email => email.trim())
    .filter(Boolean)
  if (fromEmails.length > 0) return fromEmails
  if (process.env.ADMIN_EMAIL) return [process.env.ADMIN_EMAIL]
  return []
}

// 관리자 오류 알림 — 운영자(관리자)에게만 발송되므로 한국어 고정
export async function sendAdminBulkErrorEmail(
  userName: string,
  userEmail: string,
  userId: string,
  failedItems: FailedItem[],
  trigger: DigestTrigger
): Promise<void> {
  const recipients = resolveAdminRecipients()
  if (recipients.length === 0) {
    console.log('⚠️ ADMIN_EMAILS/ADMIN_EMAIL 미설정 — 오류 알림 메일 발송 건너뜀')
    return
  }

  const today = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const errorTable = failedItems.map((item, idx) => `
    <tr style="border-bottom:1px solid #ddd">
      <td style="padding:12px;text-align:center;font-size:13px">${idx + 1}</td>
      <td style="padding:12px;font-size:13px">${item.emoji} ${item.channel}</td>
      <td style="padding:12px;font-size:13px">${item.category}</td>
      <td style="padding:12px;font-size:12px"><a href="${item.videoUrl}" style="color:#1a1a1a;text-decoration:none">${item.videoTitle}</a></td>
      <td style="padding:12px;text-align:center;font-size:12px">${item.attempts ?? '-'}</td>
      <td style="padding:12px;font-size:12px;color:#b00000">${item.errorInfo.split('\n')[0]}</td>
    </tr>
  `).join('')

  await transporter.sendMail({
    from: `"Daily Digest 오류 알림" <${process.env.GMAIL_USER}>`,
    to: recipients.join(','),
    subject: `❗ [Daily Digest] 요약 실패 알림 — ${failedItems.length}개 (${triggerLabel[trigger]})`,
    html: `
      <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:1000px;margin:0 auto;padding:24px">
        <div style="background:#fff7f7;border:1px solid #ff4757;border-radius:12px;padding:24px;margin-bottom:24px">
          <h1 style="font-size:22px;color:#b00000;margin:0 0 12px">Daily Digest 관리자 오류 알림</h1>
          <div style="font-size:14px;color:#333;line-height:1.6;margin-bottom:20px">
            <p>발송 시점: ${today}</p>
            <p>발송 경로: <strong>${triggerLabel[trigger]}</strong></p>
            <p>사용자: ${userName}</p>
            <p>사용자 이메일: ${userEmail}</p>
            <p>사용자 ID: ${userId}</p>
            <p style="font-weight:600;color:#b00000">오류 발생 영상: <strong>${failedItems.length}개</strong></p>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f5f5f5;border-bottom:2px solid #ddd">
                <th style="padding:12px;text-align:center;font-size:13px;font-weight:600">#</th>
                <th style="padding:12px;font-size:13px;font-weight:600">채널</th>
                <th style="padding:12px;font-size:13px;font-weight:600">카테고리</th>
                <th style="padding:12px;font-size:13px;font-weight:600">영상 제목</th>
                <th style="padding:12px;text-align:center;font-size:13px;font-weight:600">시도</th>
                <th style="padding:12px;font-size:13px;font-weight:600">오류</th>
              </tr>
            </thead>
            <tbody>
              ${errorTable}
            </tbody>
          </table>
          <div style="margin-top:20px;font-size:12px;color:#666">
            <p>자세한 오류 정보는 Vercel 로그를 참조하세요.</p>
          </div>
        </div>
      </div>
    `,
  })
}
