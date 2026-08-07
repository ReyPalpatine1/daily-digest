// 텔레그램 발송. 이메일(mailer.ts)과 완전히 분리된 새 파일.
// Cloudflare Workers 호환을 위해 모든 process.env 는 함수 내부에서 lazy 로 읽는다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SummaryResult } from './gemini'
import { VideoItem } from './youtube'
import { et, type EmailLocale } from './i18n/email-translations'
import { youtubeDeepLink } from '@/lib/video-time'
import { boldMarkersToHtml, splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'

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

// 'preview'는 가입 직후 1회 미리보기 발송 — 정기 발송 중복 판정(type='digest'만 셈)과 분리.
type TelegramLogType = 'digest' | 'breaking' | 'preview'

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

// 핵심 포인트 한 줄 — 앵커만 <b>로 강조(4채널 공통).
// 새 형식은 상세 요약과 같은 `**앵커.**` 마커 → 볼드 변환만 하고 추가 분리는 하지 않는다.
// 마커가 없는 과거 형식('앵커 — 부연')만 splitKeyPointPrefix로 앞부분을 굵게(하위 호환).
function keyPointLine(point: string): string {
  const p = String(point ?? '')
  if (splitBoldSegments(p).some(seg => seg.bold)) {
    return `• ${boldMarkersToHtml(escapeHtml(p), 'b')}`
  }
  const { prefix, rest } = splitKeyPointPrefix(p)
  const restHtml = escapeHtml(rest)
  return prefix ? `• <b>${escapeHtml(prefix)}</b> — ${restHtml}` : `• ${restHtml}`
}

// 단일 메시지 발송. TELEGRAM_BOT_TOKEN 미설정 시 명확한 에러로 실패(우회 발송 안 함).
// disablePreview: 링크 미리보기 끄기 여부(기본 true). 다이제스트는 끄고, 속보는 켠다.
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  disablePreview = true
): Promise<void> {
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
      disable_web_page_preview: disablePreview,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`텔레그램 발송 실패 (${res.status}): ${detail}`)
  }
}

// 여러 줄을 4096자 한도에 맞춰 메시지로 나눠 순차 발송.
// 줄 단위로 자르므로 HTML 태그가 중간에 끊기지 않는다.
async function sendLongMessage(
  chatId: string,
  lines: string[],
  disablePreview = true
): Promise<void> {
  let buf = ''
  for (const line of lines) {
    const candidate = buf ? `${buf}\n${line}` : line
    if (candidate.length > SAFE_LIMIT) {
      if (buf) {
        await sendTelegramMessage(chatId, buf, disablePreview)
        buf = line.length > SAFE_LIMIT ? '' : line
      }
      if (!buf && line.length > SAFE_LIMIT) {
        // 한 줄 자체가 한도 초과(드묾) — 안전하게 잘라 발송
        for (let i = 0; i < line.length; i += SAFE_LIMIT) {
          await sendTelegramMessage(chatId, line.slice(i, i + SAFE_LIMIT), disablePreview)
        }
      }
    } else {
      buf = candidate
    }
  }
  if (buf) await sendTelegramMessage(chatId, buf, disablePreview)
}

// 요약 1건을 텔레그램용 줄 배열로 변환.
function itemLines(item: DigestItem, lc: EmailLocale): string[] {
  const lines: string[] = []
  lines.push(`<b>${escapeHtml(item.emoji)} ${escapeHtml(item.channel)}</b> · ${escapeHtml(item.category)}`)
  lines.push(`<a href="${escapeHtml(item.video.url)}">${escapeHtml(item.video.title)}</a>`)
  // 역피라미드(열람기록과 통일): tldr(강조) → keyPoints(핵심) → timeline
  // 상세 요약은 다이제스트에서 제외한다(이메일 전용). 속보는 별도 조립이라 그대로 유지.
  if (item.summary.tldr) {
    lines.push(`<b>${escapeHtml(item.summary.tldr)}</b>`)
  }
  if (item.summary.keyPoints?.length) {
    lines.push(`<b>${et(lc, 'breaking.keyPoints')}</b>`)
    for (const p of item.summary.keyPoints) {
      lines.push(keyPointLine(p))
    }
  }
  // timeline: 줄 전체(시각+설명)가 해당 지점 딥링크 (다이제스트 전용 — 속보는 별도 조립이라 미적용).
  // 텔레그램은 CSS 미지원이라 줄 전체가 링크색으로 표시된다(챕터 목록 관행).
  // JSONB에서 온 값이 배열이 아닐 수 있어 Array.isArray 방어.
  const tl = Array.isArray(item.summary.timeline) ? item.summary.timeline : []
  if (tl.length) {
    lines.push(`<b>${et(lc, 'digest.timeline')}</b>`)
    for (const t of tl) {
      const label = `${escapeHtml(t?.time ?? '')} ${escapeHtml(t?.content ?? '')}`
      lines.push(
        item.video.url
          ? `<a href="${escapeHtml(youtubeDeepLink(item.video.url, t?.time ?? ''))}">${label}</a>`
          : label
      )
    }
  }
  return lines
}

export async function sendDigestTelegram(
  chatId: string,
  userName: string,
  items: DigestItem[],
  locale: string | null = 'ko',
  userId: string | null = null,
  // email_logs에 남길 타입. 기본 'digest'(정기·수동 발송), 미리보기만 'preview'.
  logType: TelegramLogType = 'digest'
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

  // AI 생성물 고지 — 메일·열람기록·공유페이지와 같은 문장(digest.aiNotice)을 맨 끝에.
  lines.push(escapeHtml(et(lc, 'digest.aiNotice')))
  lines.push(escapeHtml(et(lc, 'digest.footer')))

  try {
    // 다이제스트는 여러 영상을 묶어 보내므로 미리보기 끔
    await sendLongMessage(chatId, lines, true)
    await logTelegramResult(userId, chatId, logType, true)
  } catch (e) {
    await logTelegramResult(userId, chatId, logType, false, String(e))
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
    lines.push(boldMarkersToHtml(escapeHtml(item.summary.summary), 'b'))
  }
  if (item.summary.keyPoints?.length) {
    lines.push(`<b>${et(lc, 'breaking.keyPoints')}</b>`)
    for (const p of item.summary.keyPoints) {
      lines.push(keyPointLine(p))
    }
  }
  // AI 생성물 고지 — 다이제스트와 같은 문장을 맨 끝에.
  lines.push('')
  lines.push(escapeHtml(et(lc, 'digest.aiNotice')))

  try {
    // 속보는 단일 영상이므로 미리보기 켬
    await sendLongMessage(chatId, lines, false)
    await logTelegramResult(userId, chatId, 'breaking', true)
  } catch (e) {
    await logTelegramResult(userId, chatId, 'breaking', false, String(e))
    throw e
  }
}
