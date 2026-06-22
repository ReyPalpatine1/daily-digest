// 텔레그램 발송. 이메일(mailer.ts)과 완전히 분리된 새 파일.
// Cloudflare Workers 호환을 위해 모든 process.env 는 함수 내부에서 lazy 로 읽는다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SummaryResult } from './gemini'
import { VideoItem } from './youtube'
import { et, type EmailLocale } from './i18n/email-translations'

// 발송 결과 로그용 (서버 전용 service client) — mailer 를 건드리지 않기 위해 별도 lazy 생성.
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

type TelegramLogType = 'digest' | 'breaking'

// 발송 결과를 email_logs에 기록(이메일과 동일 테이블 재사용). recipient 컬럼엔 chat_id 저장.
// 실패해도 발송 흐름을 막지 않음.
async function logTelegramResult(
  userId: string | null,
  chatId: string,
  type: TelegramLogType,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    await getSupabase().from('email_logs').insert({
      user_id: userId,
      email: `tg:${chatId}`,
      type,
      status: success ? 'success' : 'failed',
      error_message: errorMessage ?? null,
    })
  } catch (e) {
    console.error('텔레그램 로그 기록 실패:', e)
  }
}

type DigestItem = {
  channel: string
  category: string
  emoji: string
  video: VideoItem
  summary: SummaryResult
}

const TELEGRAM_MAX = 4096
// 헤더/마진 여유를 두고 자른다.
const SAFE_LIMIT = 3800

function normalizeLocale(locale?: string | null): EmailLocale {
  if (locale === 'en' || locale === 'zh' || locale === 'ja') return locale
  return 'ko'
}

const dateLocaleByEmailLocale: Record<EmailLocale, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
}

// 텔레그램 HTML parse_mode 에서 본문에 들어갈 동적 문자열 이스케이프.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 단일 메시지 발송. TELEGRAM_BOT_TOKEN 미설정 시 명확한 에러로 실패(우회 발송 안 함).
export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN 미설정 — 텔레그램 발송 불가')
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`텔레그램 발송 실패 (${res.status}): ${detail}`)
  }
}

// 여러 줄을 4096자 한도에 맞춰 메시지로 나눠 순차 발송.
// 줄 단위로 자르므로 HTML 태그가 중간에 끊기지 않는다.
async function sendLongMessage(chatId: string, lines: string[]): Promise<void> {
  let buf = ''
  for (const line of lines) {
    const candidate = buf ? `${buf}\n${line}` : line
    if (candidate.length > SAFE_LIMIT) {
      if (buf) {
        await sendTelegramMessage(chatId, buf)
        buf = line.length > SAFE_LIMIT ? '' : line
      }
      if (!buf && line.length > SAFE_LIMIT) {
        // 한 줄 자체가 한도 초과(드묾) — 안전하게 잘라 발송
        for (let i = 0; i < line.length; i += SAFE_LIMIT) {
          await sendTelegramMessage(chatId, line.slice(i, i + SAFE_LIMIT))
        }
      }
    } else {
      buf = candidate
    }
  }
  if (buf) await sendTelegramMessage(chatId, buf)
}

// 요약 1건을 텔레그램용 줄 배열로 변환.
function itemLines(item: DigestItem, lc: EmailLocale): string[] {
  const lines: string[] = []
  lines.push(`<b>${escapeHtml(item.emoji)} ${escapeHtml(item.channel)}</b> · ${escapeHtml(item.category)}`)
  lines.push(`<a href="${escapeHtml(item.video.url)}">${escapeHtml(item.video.title)}</a>`)
  if (item.summary.summary) {
    lines.push(escapeHtml(item.summary.summary))
  }
  if (item.summary.keyPoints?.length) {
    lines.push(`<b>${et(lc, 'breaking.keyPoints')}</b>`)
    for (const p of item.summary.keyPoints) {
      lines.push(`• ${escapeHtml(p)}`)
    }
  }
  return lines
}

export async function sendDigestTelegram(
  chatId: string,
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

  const lines: string[] = []
  lines.push(`<b>${escapeHtml(et(lc, 'digest.greeting'))}</b>`)
  lines.push(`${escapeHtml(userName)} · ${escapeHtml(date)}`)
  lines.push(escapeHtml(et(lc, 'digest.summary', { count: items.length })))
  lines.push('')

  for (const item of items) {
    lines.push(...itemLines(item, lc))
    lines.push('')
  }

  lines.push(escapeHtml(et(lc, 'digest.footer')))

  try {
    await sendLongMessage(chatId, lines)
    await logTelegramResult(userId, chatId, 'digest', true)
  } catch (e) {
    await logTelegramResult(userId, chatId, 'digest', false, String(e))
    throw e
  }
}

export async function sendBreakingTelegram(
  chatId: string,
  userName: string,
  item: DigestItem,
  locale: string | null = 'ko',
  userId: string | null = null
): Promise<void> {
  const lc = normalizeLocale(locale)
  const published = new Date(item.video.publishedAt).toLocaleString(dateLocaleByEmailLocale[lc], {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const lines: string[] = []
  lines.push(`<b>${escapeHtml(et(lc, 'breaking.heading'))}</b>`)
  lines.push(`<b>${escapeHtml(item.emoji)} ${escapeHtml(item.channel)}</b>`)
  lines.push(`<a href="${escapeHtml(item.video.url)}">${escapeHtml(item.video.title)}</a>`)
  lines.push(`${escapeHtml(et(lc, 'breaking.publishedAt'))}: ${escapeHtml(published)}`)
  if (item.summary.summary) {
    lines.push('')
    lines.push(escapeHtml(item.summary.summary))
  }
  if (item.summary.keyPoints?.length) {
    lines.push(`<b>${et(lc, 'breaking.keyPoints')}</b>`)
    for (const p of item.summary.keyPoints) {
      lines.push(`• ${escapeHtml(p)}`)
    }
  }

  try {
    await sendLongMessage(chatId, lines)
    await logTelegramResult(userId, chatId, 'breaking', true)
  } catch (e) {
    await logTelegramResult(userId, chatId, 'breaking', false, String(e))
    throw e
  }
}
