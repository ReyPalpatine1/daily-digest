import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SummaryResult } from './gemini'
import { VideoItem } from './youtube'
import { et, type EmailLocale } from './i18n/email-translations'
import {
  buildDigestHtml,
  buildBreakingHtml,
  buildWelcomeHtml,
  buildTrialEndingHtml,
  buildTrialEndedHtml,
  buildPassEndingHtml,
  buildPassEndedHtml,
} from './email-templates'

// Cloudflare Email Sending REST API 발송.
// SMTP(소켓)는 Workers의 global_fetch_strictly_public 제약으로 연결 불가라 HTTPS fetch 사용.
// account_id는 공개값이라 상수, 토큰(CF_EMAIL_TOKEN)은 함수 내부에서 읽음(Cloudflare 호환).
const CF_ACCOUNT_ID = 'd0c818cc564e1942b7bd8f65c6c53fcb'
async function sendViaCloudflare(opts: { from: string; to: string; subject: string; html: string; text?: string }): Promise<void> {
  const token = process.env.CF_EMAIL_TOKEN
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/email/sending/send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: opts.from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text ?? '' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Cloudflare email send failed: ${res.status} ${body.slice(0, 300)}`)
  }
}

// 이메일 발송 로그 기록용 (서버 전용 service client).
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 처리 시점에 채워짐)
// 최상단이 아니라 첫 사용 시점에 lazy 생성한다.
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return _supabase
}

const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

// 'preview'는 가입 직후 1회 미리보기 발송 — 정기 발송 중복 판정(hasDigestSentToday는
// type='digest'만 센다)에 섞이지 않도록 별도 타입으로 기록한다.
export type EmailLogType = 'digest' | 'breaking' | 'error' | 'welcome' | 'preview'

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
  userId: string | null = null,
  // 기본값 true = 광고 없음. 무료 사용자임이 확실할 때만 false로 광고 노출.
  isPro = true,
  // email_logs에 남길 타입. 기본 'digest'(정기·수동 발송), 미리보기만 'preview'.
  logType: EmailLogType = 'digest'
): Promise<void> {
  const lc = normalizeLocale(locale)
  const date = new Date().toLocaleDateString(dateLocaleByEmailLocale[lc], {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  try {
    await sendViaCloudflare({
      from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
      to,
      subject: et(lc, 'digest.subject', { date }),
      html: buildDigestHtml(items, userName, lc, to, isPro),
    })
    await logEmailResult(userId, to, logType, true)
  } catch (e) {
    await logEmailResult(userId, to, logType, false, String(e))
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
    await sendViaCloudflare({
      from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
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
    await sendViaCloudflare({
      from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
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
  await sendViaCloudflare({
    from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
    to,
    subject: et(lc, 'welcome.subject'),
    html: buildWelcomeHtml(lc),
  })
}

// 체험 종료 전날 예고 메일. endDate는 호출 측에서 로케일에 맞게 포맷한 문자열.
export async function sendTrialEndingEmail(
  to: string,
  endDate: string,
  locale: string | null = 'ko'
): Promise<void> {
  const lc = normalizeLocale(locale)
  await sendViaCloudflare({
    from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
    to,
    subject: et(lc, 'trialEnding.subject'),
    html: buildTrialEndingHtml(lc, endDate),
  })
}

// 체험 종료 당일 무료 플랜 전환 안내 메일.
export async function sendTrialEndedEmail(
  to: string,
  locale: string | null = 'ko'
): Promise<void> {
  const lc = normalizeLocale(locale)
  await sendViaCloudflare({
    from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
    to,
    subject: et(lc, 'trialEnded.subject'),
    html: buildTrialEndedHtml(lc),
  })
}

// 1개월권(일회성 결제) 만료 전날 예고 메일. endDate는 호출 측에서 로케일에 맞게 포맷한 문자열.
export async function sendPassEndingEmail(
  to: string,
  endDate: string,
  locale: string | null = 'ko'
): Promise<void> {
  const lc = normalizeLocale(locale)
  await sendViaCloudflare({
    from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
    to,
    subject: et(lc, 'passEnding.subject'),
    html: buildPassEndingHtml(lc, endDate),
  })
}

// 1개월권(일회성 결제) 만료 당일 무료 플랜 전환 안내 메일.
export async function sendPassEndedEmail(
  to: string,
  locale: string | null = 'ko'
): Promise<void> {
  const lc = normalizeLocale(locale)
  await sendViaCloudflare({
    from: `"Daily Video Digest" <${process.env.MAIL_FROM}>`,
    to,
    subject: et(lc, 'passEnded.subject'),
    html: buildPassEndedHtml(lc),
  })
}

export type FailedItem = {
  channel: string
  category: string
  emoji: string
  videoTitle: string
  videoUrl: string
  errorInfo: string
  attempts?: number
  reason?: string // fail_reason 코드 (텔레그램 알림 표기용 — 이메일 포맷엔 미사용)
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

  const mail = {
    from: `"Daily Video Digest 오류 알림" <${process.env.MAIL_FROM}>`,
    subject: `❗ [Daily Video Digest] 요약 실패 알림 — ${failedItems.length}개 (${triggerLabel[trigger]})`,
    html: `
      <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:1000px;margin:0 auto;padding:24px">
        <div style="background:#fff7f7;border:1px solid #ff4757;border-radius:12px;padding:24px;margin-bottom:24px">
          <h1 style="font-size:22px;color:#b00000;margin:0 0 12px">Daily Video Digest 관리자 오류 알림</h1>
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
  }

  // Cloudflare API는 단일 수신자 기준 — 수신자별 개별 발송, 하나 실패가 나머지를 막지 않게.
  for (const to of recipients) {
    try {
      await sendViaCloudflare({ ...mail, to })
    } catch (e) {
      console.error(`관리자 오류 알림 메일 발송 실패 (${to}):`, e)
    }
  }
}

// 관리자 피드백 알림 — 운영자(관리자)에게만 발송되므로 한국어 고정
export async function sendAdminFeedbackEmail(feedback: {
  userEmail: string
  rating: number | null
  type: string
  message: string
}): Promise<void> {
  const recipients = resolveAdminRecipients()
  if (recipients.length === 0) {
    console.log('⚠️ ADMIN_EMAILS/ADMIN_EMAIL 미설정 — 피드백 알림 메일 발송 건너뜀')
    return
  }

  // APP_URL은 기존 email-templates 방식과 동일하게 함수 내부에서 읽는다(Cloudflare 호환).
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')

  const now = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const typeLabel: Record<string, string> = {
    general: '일반 의견',
    bug: '불편/버그',
    feature: '기능 제안',
  }
  const ratingLabel = feedback.rating ? `${feedback.rating} / 5` : '-'

  // 사용자 입력은 HTML 이스케이프 후 줄바꿈만 <br>로.
  const safeMessage = feedback.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  const mail = {
    from: `"Daily Video Digest 피드백" <${process.env.MAIL_FROM}>`,
    subject: '[피드백] 새 의견 도착',
    html: `
      <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#f8f9fb;border:1px solid #e2e5ea;border-radius:12px;padding:24px">
          <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 16px">새 의견 도착</h1>
          <div style="font-size:14px;color:#333;line-height:1.7;margin-bottom:20px">
            <p style="margin:0 0 6px">접수 시각: ${now}</p>
            <p style="margin:0 0 6px">유형: <strong>${typeLabel[feedback.type] ?? feedback.type}</strong></p>
            <p style="margin:0 0 6px">별점: <strong>${ratingLabel}</strong></p>
            <p style="margin:0 0 6px">작성자: ${feedback.userEmail || '(알 수 없음)'}</p>
          </div>
          <div style="background:#fff;border:1px solid #e2e5ea;border-radius:8px;padding:16px;font-size:14px;color:#333;line-height:1.7">
            ${safeMessage}
          </div>
          <div style="margin-top:20px">
            <a href="${appUrl}/admin/feedback" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">관리자 페이지에서 확인</a>
          </div>
        </div>
      </div>
    `,
  }

  // Cloudflare API는 단일 수신자 기준 — 수신자별 개별 발송, 하나 실패가 나머지를 막지 않게.
  for (const to of recipients) {
    try {
      await sendViaCloudflare({ ...mail, to })
    } catch (e) {
      console.error(`관리자 피드백 알림 메일 발송 실패 (${to}):`, e)
    }
  }
}

// 관리자 공유 신고 알림 — 운영자(관리자)에게만 발송되므로 한국어 고정
export async function sendAdminShareReportEmail(report: {
  token: string
  reasonLabel: string
  detail: string | null
  sharedBy: string | null
  commentSnapshot: string | null
  videoTitle: string | null
}): Promise<void> {
  const recipients = resolveAdminRecipients()
  if (recipients.length === 0) {
    console.log('⚠️ ADMIN_EMAILS/ADMIN_EMAIL 미설정 — 공유 신고 알림 메일 발송 건너뜀')
    return
  }

  // APP_URL은 기존 email-templates 방식과 동일하게 함수 내부에서 읽는다(Cloudflare 호환).
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')
  const shareUrl = `${appUrl}/s/${report.token}`

  const now = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  // 사용자 입력은 HTML 이스케이프 후 줄바꿈만 <br>로. (피드백 알림과 동일 규칙)
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

  const safeDetail = report.detail ? escape(report.detail) : '(상세 내용 없음)'
  const safeComment = report.commentSnapshot ? escape(report.commentSnapshot) : '(메모 없음)'

  const mail = {
    from: `"Daily Video Digest 공유 신고" <${process.env.MAIL_FROM}>`,
    subject: '[신고] 공유 페이지 신고 접수',
    html: `
      <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#f8f9fb;border:1px solid #e2e5ea;border-radius:12px;padding:24px">
          <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 16px">공유 페이지 신고 접수</h1>
          <div style="font-size:14px;color:#333;line-height:1.7;margin-bottom:20px">
            <p style="margin:0 0 6px">접수 시각: ${now}</p>
            <p style="margin:0 0 6px">신고 사유: <strong>${escape(report.reasonLabel)}</strong></p>
            <p style="margin:0 0 6px">영상 제목: ${report.videoTitle ? escape(report.videoTitle) : '(알 수 없음)'}</p>
            <p style="margin:0 0 6px">공유 토큰: ${escape(report.token)}</p>
            <p style="margin:0 0 6px">공유자 ID: ${report.sharedBy ? escape(report.sharedBy) : '(알 수 없음)'}</p>
            <p style="margin:0 0 6px">공유 페이지: <a href="${shareUrl}" style="color:#1a1a1a">${shareUrl}</a></p>
          </div>
          <div style="font-size:12px;color:#666;margin:0 0 6px">상세 내용</div>
          <div style="background:#fff;border:1px solid #e2e5ea;border-radius:8px;padding:16px;font-size:14px;color:#333;line-height:1.7;margin-bottom:16px">
            ${safeDetail}
          </div>
          <div style="font-size:12px;color:#666;margin:0 0 6px">공유자 메모(신고 시점)</div>
          <div style="background:#fff;border:1px solid #e2e5ea;border-radius:8px;padding:16px;font-size:14px;color:#333;line-height:1.7">
            ${safeComment}
          </div>
        </div>
      </div>
    `,
  }

  // Cloudflare API는 단일 수신자 기준 — 수신자별 개별 발송, 하나 실패가 나머지를 막지 않게.
  for (const to of recipients) {
    try {
      await sendViaCloudflare({ ...mail, to })
    } catch (e) {
      console.error(`관리자 공유 신고 알림 메일 발송 실패 (${to}):`, e)
    }
  }
}

// 관리자 신규 오류 집계 알림 — 운영자(관리자)에게만 발송되므로 한국어 고정
export async function sendAdminNewErrorsEmail(count: number): Promise<void> {
  const recipients = resolveAdminRecipients()
  if (recipients.length === 0) {
    console.log('⚠️ ADMIN_EMAILS/ADMIN_EMAIL 미설정 — 신규 오류 알림 메일 발송 건너뜀')
    return
  }

  // APP_URL은 기존 email-templates 방식과 동일하게 함수 내부에서 읽는다(Cloudflare 호환).
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')

  const mail = {
    from: `"Daily Video Digest 오류 알림" <${process.env.MAIL_FROM}>`,
    subject: `[오류] 새 오류 ${count}건`,
    html: `
      <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#fff7f7;border:1px solid #ff4757;border-radius:12px;padding:24px">
          <h1 style="font-size:20px;color:#b00000;margin:0 0 16px">새 오류가 쌓였습니다</h1>
          <div style="font-size:14px;color:#333;line-height:1.7;margin-bottom:20px">
            <p style="margin:0">관리자 오류 페이지에 새 오류가 <strong>${count}건</strong> 쌓였습니다.</p>
          </div>
          <div>
            <a href="${appUrl}/admin/errors" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">관리자 오류 페이지에서 확인</a>
          </div>
        </div>
      </div>
    `,
  }

  // Cloudflare API는 단일 수신자 기준 — 수신자별 개별 발송, 하나 실패가 나머지를 막지 않게.
  for (const to of recipients) {
    try {
      await sendViaCloudflare({ ...mail, to })
    } catch (e) {
      console.error(`관리자 신규 오류 알림 메일 발송 실패 (${to}):`, e)
    }
  }
}
