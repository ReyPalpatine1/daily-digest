// 이메일 HTML 템플릿 (순수 함수 — nodemailer 의존성 없음).
// 서버(mailer.ts)와 클라이언트(admin/email-preview)에서 모두 import 가능.

import { et, type EmailLocale } from './i18n/email-translations'

export type { EmailLocale }

export type EmailDigestItem = {
  channel: string
  category: string
  emoji: string
  video: { title: string; url: string; publishedAt: string }
  summary: {
    summary: string
    keyPoints: string[]
    timeline: { time: string; content: string }[]
    summaryBasis?: string
    errorInfo?: string
    failReason?: string // no_source | temporary | pending | live | pro_only — 실패·대기·라이브·Pro 전용 항목 표기용
  }
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')

function dateLocaleCode(locale: EmailLocale): string {
  return ({ ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' } as Record<EmailLocale, string>)[locale] ?? 'en-US'
}

function formatDate(date: Date, locale: EmailLocale): string {
  return date.toLocaleDateString(dateLocaleCode(locale), {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(iso: string, locale: EmailLocale): string {
  return new Date(iso).toLocaleString(dateLocaleCode(locale), {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// JSONB에서 읽은 값이 배열이 아닐 수 있어(문자열/객체/null) .map 호출 전 안전 변환.
// - 배열이면 그대로
// - JSON 문자열이면 파싱해서 배열이면 사용 (이중 인코딩 방어)
// - 그 외엔 빈 배열
function safeArray<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

// 이메일 공통 레이아웃 (라이트 테마 고정 — 메일은 디자인 시스템 변수 미지원)
function shell(title: string, locale: EmailLocale, inner: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:'Inter','Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:600px;margin:0 auto;">
    <tr>
      <td style="padding:24px 20px;">
        ${inner}
        ${footer}
      </td>
    </tr>
  </table>
</body>
</html>`
}

function footerBlock(locale: EmailLocale, email?: string): string {
  return `
    <div style="text-align:center;padding:20px 0 8px;border-top:1px solid #E5E5E5;margin-top:24px;">
      <div style="font-size:13px;font-weight:600;color:#0A0A0A;letter-spacing:-0.01em;">Daily Video Digest</div>
      <div style="font-size:11px;color:#A1A1AA;margin-top:4px;">${et(locale, 'digest.tagline')}</div>
      <div style="margin-top:14px;font-size:11px;">
        <a href="${APP_URL}/dashboard" style="color:#525252;text-decoration:underline;">${et(locale, 'digest.manageLink')}</a>
        &nbsp;·&nbsp;
        <a href="${APP_URL}/feedback" style="color:#525252;text-decoration:underline;">${et(locale, 'digest.feedbackLink')}</a>
      </div>
      ${email ? `<div style="font-size:11px;color:#A1A1AA;margin-top:14px;">${escapeHtml(et(locale, 'digest.sentTo', { email }))}</div>` : ''}
    </div>`
}

// summaryBasis(한국어 라벨)를 분석 소스 표기 번역 키로 매핑. 매칭 안 되면 null(표기 생략).
function basisTranslationKey(summaryBasis?: string): string | null {
  if (!summaryBasis) return null
  if (summaryBasis.includes('자막')) return 'digest.basisTranscript'
  if (summaryBasis.includes('설명')) return 'digest.basisDescription'
  if (summaryBasis.includes('제목')) return 'digest.basisTitle'
  return null
}

// fail_reason 코드 → 실패·대기·라이브·Pro 전용 문구 번역 키. 매칭 안 되면 null(정상 요약 표기).
function failReasonTranslationKey(failReason?: string): string | null {
  if (failReason === 'no_source') return 'digest.failNoSource'
  if (failReason === 'temporary') return 'digest.failTemporary'
  if (failReason === 'pending') return 'digest.failPending'
  if (failReason === 'live') return 'digest.failLive'
  if (failReason === 'pro_only') return 'digest.proOnly'
  return null
}

function digestCard(item: EmailDigestItem, locale: EmailLocale): string {
  const kp = safeArray<string>(item.summary.keyPoints)
  const tl = safeArray<{ time: string; content: string }>(item.summary.timeline)
  const basisKey = basisTranslationKey(item.summary.summaryBasis)
  const failKey = failReasonTranslationKey(item.summary.failReason)
  return `
    <div style="background:#FFFFFF;border-radius:10px;padding:20px 24px;border:1px solid #E5E5E5;margin-bottom:12px;">
      ${item.summary.errorInfo ? '' : ''}
      <div style="font-size:11px;color:#71717A;margin-bottom:6px;">
        ${item.emoji ? `${escapeHtml(item.emoji)} ` : ''}${escapeHtml(item.channel)}${item.category ? ` · ${escapeHtml(item.category)}` : ''}
      </div>
      <div style="font-size:16px;font-weight:600;color:#0A0A0A;margin-bottom:6px;line-height:1.4;">
        <a href="${escapeHtml(item.video.url)}" style="color:#0A0A0A;text-decoration:none;">${escapeHtml(item.video.title)}</a>
      </div>
      <div style="font-size:11px;color:#A1A1AA;margin-bottom:12px;">
        🕐 ${escapeHtml(formatTime(item.video.publishedAt, locale))} ${et(locale, 'digest.uploadedAt')}
      </div>
      ${failKey ? `
      <div style="font-size:12px;color:#A1A1AA;line-height:1.7;margin-bottom:12px;">
        ${escapeHtml(et(locale, failKey))}
      </div>` : `
      <div style="font-size:13px;color:#525252;line-height:1.7;margin-bottom:12px;">
        ${escapeHtml(item.summary.summary)}
      </div>`}
      ${kp.length > 0 ? `
        <div style="background:#FAFAFA;border-radius:7px;padding:12px 14px;margin-bottom:12px;">
          <div style="font-size:12px;font-weight:600;color:#0A0A0A;margin-bottom:6px;">${et(locale, 'digest.keyPoints')}</div>
          <ul style="margin:0;padding-left:16px;">
            ${kp.map(p => `<li style="font-size:12px;color:#525252;line-height:1.7;">${escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${tl.length > 0 ? `
        <div style="background:#FAFAFA;border-radius:7px;padding:12px 14px;margin-bottom:12px;">
          <div style="font-size:12px;font-weight:600;color:#0A0A0A;margin-bottom:6px;">${et(locale, 'digest.timeline')}</div>
          ${tl.map(tt => `
            <div style="font-size:12px;color:#525252;line-height:1.7;margin-bottom:3px;">
              <span style="background:#F4F4F5;color:#0A0A0A;padding:1px 6px;border-radius:4px;margin-right:6px;font-weight:500;">${escapeHtml(tt.time)}</span>${escapeHtml(tt.content)}
            </div>`).join('')}
        </div>` : ''}
      <a href="${escapeHtml(item.video.url)}" style="display:inline-block;padding:7px 14px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:12px;font-weight:500;">
        ${et(locale, 'digest.watchVideo')}
      </a>
      ${basisKey && !failKey ? `
        <div style="font-size:11px;color:#A1A1AA;margin-top:14px;">${escapeHtml(et(locale, basisKey))}</div>` : ''}
    </div>`
}

export function buildDigestHtml(
  items: EmailDigestItem[],
  userName: string,
  locale: EmailLocale = 'ko',
  email?: string
): string {
  const date = formatDate(new Date(), locale)
  const header = `
    <a href="${APP_URL}/dashboard" style="text-decoration:none;color:inherit;display:block;">
    <div style="background:#FFFFFF;border-radius:10px;padding:20px 24px;border:1px solid #E5E5E5;margin-bottom:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:13px;font-weight:600;color:#0A0A0A;">
            <span style="display:inline-block;width:20px;height:20px;background:#0A0A0A;border-radius:6px;vertical-align:middle;margin-right:7px;"></span>Daily Video Digest
          </td>
          <td style="font-size:11px;color:#71717A;text-align:right;">${escapeHtml(date)}</td>
        </tr>
      </table>
      <div style="font-size:18px;font-weight:600;color:#0A0A0A;margin-top:10px;">${et(locale, 'digest.greeting')}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;">
        <tr>
          <td style="font-size:13px;color:#71717A;">${escapeHtml(et(locale, 'digest.summary', { count: items.length }))}</td>
          <td style="font-size:12px;color:#3f3f46;font-weight:500;text-align:right;white-space:nowrap;">${escapeHtml(et(locale, 'digest.openApp'))}</td>
        </tr>
      </table>
    </div>
    </a>`
  const body = items.length > 0
    ? items.map(it => digestCard(it, locale)).join('')
    : `<div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;color:#A1A1AA;font-size:13px;">${et(locale, 'digest.noVideos')}</div>`
  return shell(et(locale, 'digest.subject', { date }), locale, header + body, footerBlock(locale, email))
}

export function buildBreakingHtml(
  item: EmailDigestItem,
  userName: string,
  locale: EmailLocale = 'ko',
  email?: string
): string {
  const header = `
    <div style="background:#FFFFFF;border-radius:10px;padding:20px 24px;border:1px solid #DC2626;border-left:4px solid #DC2626;margin-bottom:16px;">
      <div style="display:inline-block;padding:2px 8px;background:#FEE2E2;color:#DC2626;border-radius:5px;font-size:11px;font-weight:600;margin-bottom:8px;">
        ${et(locale, 'digest.breaking')}
      </div>
      <div style="font-size:18px;font-weight:600;color:#0A0A0A;">${et(locale, 'breaking.heading')}</div>
    </div>`
  return shell(
    et(locale, 'breaking.subject', { title: item.video.title }),
    locale,
    header + digestCard(item, locale),
    footerBlock(locale, email),
  )
}

export function buildWelcomeHtml(locale: EmailLocale = 'ko'): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">🎉</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'welcome.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'welcome.desc')}</div>
      <a href="${APP_URL}/dashboard" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'welcome.startCta')}
      </a>
    </div>`
  return shell(et(locale, 'welcome.subject'), locale, inner, footerBlock(locale))
}

// 체험 종료 전날 예고 메일. 체험은 카드 없이 시작되므로 자동 결제가 없다.
export function buildTrialEndingHtml(locale: EmailLocale = 'ko', endDate: string): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">⏳</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'trialEnding.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'trialEnding.desc', { date: endDate })}</div>
      <a href="${APP_URL}/subscribe?mode=pay" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'trialEnding.cta')}
      </a>
    </div>`
  return shell(et(locale, 'trialEnding.subject'), locale, inner, footerBlock(locale))
}

// 체험 종료 당일 무료 플랜 전환 안내 메일.
export function buildTrialEndedHtml(locale: EmailLocale = 'ko'): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">📩</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'trialEnded.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'trialEnded.desc')}</div>
      <a href="${APP_URL}/subscribe?mode=pay" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'trialEnded.cta')}
      </a>
    </div>`
  return shell(et(locale, 'trialEnded.subject'), locale, inner, footerBlock(locale))
}

// 1개월권(일회성 결제) 만료 전날 예고 메일. 일회성 결제라 자동 갱신이 없다.
export function buildPassEndingHtml(locale: EmailLocale = 'ko', endDate: string): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">⏳</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'passEnding.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'passEnding.desc', { date: endDate })}</div>
      <a href="${APP_URL}/subscribe?mode=pay" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'passEnding.cta')}
      </a>
    </div>`
  return shell(et(locale, 'passEnding.subject'), locale, inner, footerBlock(locale))
}

// 1개월권(일회성 결제) 만료 당일 무료 플랜 전환 안내 메일.
export function buildPassEndedHtml(locale: EmailLocale = 'ko'): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">📩</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'passEnded.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'passEnded.desc')}</div>
      <a href="${APP_URL}/subscribe?mode=pay" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'passEnded.cta')}
      </a>
    </div>`
  return shell(et(locale, 'passEnded.subject'), locale, inner, footerBlock(locale))
}

// 미리보기 전용 — 시스템 알림 메일 모양
export function buildErrorPreviewHtml(locale: EmailLocale = 'ko'): string {
  const now = formatTime(new Date().toISOString(), locale)
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:24px;border:1px solid #E5E5E5;">
      <div style="font-size:18px;font-weight:600;color:#0A0A0A;margin-bottom:12px;">${et(locale, 'error.heading')}</div>
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        <div>${et(locale, 'error.message')}:</div>
        <div style="background:#FAFAFA;border-radius:7px;padding:12px;margin-top:8px;font-size:12px;color:#DC2626;">
          TranscriptUnavailable: video transcript could not be fetched
        </div>
        <div style="margin-top:10px;">${et(locale, 'error.time')}: ${escapeHtml(now)}</div>
        <div style="margin-top:4px;">${et(locale, 'error.action')}</div>
      </div>
    </div>`
  return shell(et(locale, 'error.subject'), locale, inner, footerBlock(locale))
}

// 미리보기용 더미 데이터
export function dummyDigestItems(locale: EmailLocale): EmailDigestItem[] {
  if (locale === 'en') {
    return [
      {
        channel: 'Bloomberg', category: 'Economy', emoji: '📈',
        video: { title: 'Fed Holds Rates Steady, Signals Caution', url: 'https://youtube.com', publishedAt: new Date().toISOString() },
        summary: {
          summary: 'The Federal Reserve kept interest rates unchanged, citing persistent inflation and a resilient labor market.',
          keyPoints: ['Rates unchanged at 5.25–5.50%', 'Inflation still above the 2% target', 'Two cuts projected later this year'],
          timeline: [{ time: '00:42', content: 'Opening statement from the chair' }, { time: '12:30', content: 'Q&A on the rate path' }],
        },
      },
      {
        channel: 'Marques Brownlee', category: 'Tech', emoji: '🎬',
        video: { title: 'The Best Phone Cameras of 2026', url: 'https://youtube.com', publishedAt: new Date(Date.now() - 7200_000).toISOString() },
        summary: {
          summary: 'A blind comparison of flagship phone cameras, ranking low-light and color accuracy across eight devices.',
          keyPoints: ['Low-light winner surprised everyone', 'Color science still varies widely'],
          timeline: [],
        },
      },
    ]
  }
  return [
    {
      channel: 'YTN', category: '지정학', emoji: '📡',
      video: { title: '미·중 정상 통화, 무역 긴장 완화 신호', url: 'https://youtube.com', publishedAt: new Date().toISOString() },
      summary: {
        summary: '양국 정상이 통화에서 관세 인하 가능성을 논의하며 무역 갈등 완화 분위기가 형성됐습니다.',
        keyPoints: ['관세 단계적 인하 검토', '추가 실무 협상 일정 합의', '시장은 즉시 긍정 반응'],
        timeline: [{ time: '00:30', content: '통화 배경 설명' }, { time: '05:10', content: '주요 합의 내용 정리' }],
      },
    },
    {
      channel: '소수몽키', category: '경제', emoji: '💰',
      video: { title: '반도체 사이클, 지금이 저점일까?', url: 'https://youtube.com', publishedAt: new Date(Date.now() - 7200_000).toISOString() },
      summary: {
        summary: '메모리 반도체 가격 흐름과 재고 지표를 근거로 사이클 저점 가능성을 진단했습니다.',
        keyPoints: ['재고 조정 막바지 국면', '하반기 수요 회복 기대'],
        timeline: [],
      },
    },
  ]
}

export function dummyBreakingItem(locale: EmailLocale): EmailDigestItem {
  if (locale === 'en') {
    return {
      channel: 'Reuters', category: 'Markets', emoji: '⚡',
      video: { title: 'Breaking: Major Index Drops 3% on Rate Fears', url: 'https://youtube.com', publishedAt: new Date().toISOString() },
      summary: {
        summary: 'Equity markets fell sharply after stronger-than-expected inflation data renewed rate-hike concerns.',
        keyPoints: ['Index down 3% intraday', 'Bond yields spiked'],
        timeline: [],
      },
    }
  }
  return {
    channel: '부읽남TV', category: '재테크', emoji: '🚨',
    video: { title: '속보: 삼성전자 실적 발표, 시장 예상 상회', url: 'https://youtube.com', publishedAt: new Date().toISOString() },
    summary: {
      summary: '삼성전자가 시장 예상을 웃도는 분기 실적을 발표하며 주가가 장중 강세를 보였습니다.',
      keyPoints: ['영업이익 컨센서스 상회', '반도체 부문 회복 뚜렷'],
      timeline: [],
    },
  }
}
