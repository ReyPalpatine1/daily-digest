// 이메일 HTML 템플릿 (순수 함수 — nodemailer 의존성 없음).
// 서버(mailer.ts)와 클라이언트(admin/email-preview)에서 모두 import 가능.

import { et, type EmailLocale } from './i18n/email-translations'
import { nowUtc, toZoned } from './time'
import { youtubeDeepLink } from '@/lib/video-time'
import { partnerBannerByDay, type PartnerBanner } from '@/lib/ads'
import { boldMarkersToHtml, splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'

export type { EmailLocale }

export type EmailDigestItem = {
  channel: string
  category: string
  emoji: string
  video: { title: string; url: string; publishedAt: string }
  summary: {
    tldr?: string // 결론 한 줄(역피라미드 최상단, 라벨 없이 강조). 과거 데이터엔 없을 수 있어 옵셔널.
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

// summary(앵커 문단 형식)를 이메일 HTML로: 문단(\n\n) 분리 + `**앵커.**` → <strong>.
// 이스케이프 먼저 → 볼드 마커 변환 순서 준수. 마커 없는 과거 데이터는 통짜 문단으로 렌더(하위 호환).
// 앵커에 색을 직접 지정한다 — 미지정 시 본문 회색(#525252)을 상속해 강조가 죽는다.
function renderSummaryHtml(summary: string): string {
  const paras = String(summary ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  if (!paras.length) return ''
  return paras
    .map((p, i) => `<div${i < paras.length - 1 ? ' style="margin-bottom:8px;"' : ''}>${boldMarkersToHtml(escapeHtml(p), 'strong', 'color:#1a1a1c;')}</div>`)
    .join('')
}

// 요약 섹션 라벨 공통 스타일(핵심 포인트·상세 요약·타임라인 — 4채널 통일).
const SECTION_LABEL_STYLE = 'font-size:11px;color:#8a8a8e;font-weight:600;letter-spacing:0.6px;margin-bottom:9px;'

// 핵심 포인트 한 줄 — 불릿/박스 없이 앵커만 세미볼드(4채널 공통).
// 새 형식은 상세 요약과 같은 `**앵커.**` 마커 → 볼드 변환만 하고 추가 분리는 하지 않는다.
// 과거 형식('앵커 — 부연')은 마커가 없으므로 splitKeyPointPrefix로 앞부분을 굵게(하위 호환).
// 이스케이프 먼저 → 볼드 마커 변환 순서 준수.
function renderKeyPointHtml(point: string): string {
  const p = String(point ?? '')
  const wrap = (inner: string) =>
    `<div style="font-size:13px;color:#525252;line-height:1.6;margin-bottom:9px;">${inner}</div>`
  if (splitBoldSegments(p).some(seg => seg.bold)) {
    return wrap(boldMarkersToHtml(escapeHtml(p), 'strong', 'color:#1a1a1c;'))
  }
  const { prefix, rest } = splitKeyPointPrefix(p)
  const restHtml = boldMarkersToHtml(escapeHtml(rest), 'strong')
  const prefixHtml = prefix
    ? `<span style="color:#1a1a1c;font-weight:600;">${escapeHtml(prefix)} — </span>`
    : ''
  return wrap(`${prefixHtml}${restHtml}`)
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
  // Gmail이 매일 동일한 푸터를 "반복 내용"으로 접는 것을 완화하기 위해 발송 날짜를 넣어 내용을 변화시킨다.
  // 새 시간 로직을 만들지 않고 @/lib/time의 nowUtc + 기존 formatDate(KST·locale 매핑)를 재사용.
  const footerDate = formatDate(nowUtc(), locale)
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
      <div style="font-size:11px;color:#A1A1AA;margin-top:6px;">© Daily Video Digest · ${footerDate}</div>
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
        ${escapeHtml(formatTime(item.video.publishedAt, locale))} ${et(locale, 'digest.uploadedAt')}
      </div>
      ${failKey ? `
      <div style="font-size:12px;color:#A1A1AA;line-height:1.7;margin-bottom:12px;">
        ${escapeHtml(et(locale, failKey))}
      </div>` : `
      ${item.summary.tldr ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
        <tr>
          <td style="width:3px;background:#1a1a1c;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding-left:12px;font-size:14.5px;font-weight:600;color:#1a1a1c;line-height:1.6;">${escapeHtml(item.summary.tldr)}</td>
        </tr>
      </table>` : ''}
      ${kp.length > 0 ? `
        <div style="background:#F5F5F5;border-radius:8px;padding:14px 15px;margin-bottom:20px;">
          <div style="${SECTION_LABEL_STYLE}">${et(locale, 'digest.keyPoints')}</div>
          ${kp.map(p => renderKeyPointHtml(p)).join('')}
        </div>` : ''}
      <div style="${SECTION_LABEL_STYLE}">${et(locale, 'digest.detailSummary')}</div>
      <div style="font-size:13px;color:#525252;line-height:1.8;margin-bottom:20px;">
        ${renderSummaryHtml(item.summary.summary)}
      </div>
      ${tl.length > 0 ? `
        <div style="margin-bottom:20px;">
          <div style="${SECTION_LABEL_STYLE}">${et(locale, 'digest.timeline')}</div>
          ${tl.map(tt => {
            // 챕터 목록 관행: 줄 전체(시각+설명)가 해당 지점 딥링크.
            // url 없으면 링크 없이 텍스트만(폴백). 시각 파싱 실패 시 youtubeDeepLink가 원본 URL 반환.
            const timeHtml = `<span style="color:#0A0A0A;font-weight:600;margin-right:6px;">${escapeHtml(tt.time)}</span>`
            const contentHtml = `<span style="color:#525252;">${escapeHtml(tt.content)}</span>`
            const inner = item.video.url
              ? `<a href="${escapeHtml(youtubeDeepLink(item.video.url, tt.time))}" style="text-decoration:none;">${timeHtml}${contentHtml}</a>`
              : `${timeHtml}${contentHtml}`
            return `
            <div style="font-size:12px;line-height:1.7;margin-bottom:3px;">
              ${inner}
            </div>`
          }).join('')}
        </div>` : ''}`}
      <a href="${escapeHtml(item.video.url)}" style="display:inline-block;padding:7px 14px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:12px;font-weight:500;">
        ${et(locale, 'digest.watchVideo')}
      </a>
      ${basisKey && !failKey ? `
        <div style="font-size:11px;color:#A1A1AA;margin-top:14px;">${escapeHtml(et(locale, basisKey))}</div>` : ''}
    </div>`
}

// 무료 사용자 다이제스트 하단(요약 끝·푸터 위) 광고 슬롯 — Pro 배너.
// Pro/VIP에게는 렌더하지 않는다("광고 없음" 약속). 다른 메일에는 넣지 말 것.
// CTA는 /api/ad-click 경유 — 클릭 기록 후 /pricing 으로 302.
function adBlock(locale: EmailLocale): string {
  return `
    <div style="padding:16px 20px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <div style="font-size:10px;color:#a0a0a4;letter-spacing:0.5px;margin-bottom:8px;">${et(locale, 'digest.adLabel')}</div>
      <div style="font-size:13.5px;font-weight:600;margin-bottom:3px;color:#1a1a1c;">${et(locale, 'digest.adTitle')}</div>
      <div style="font-size:12px;color:#525252;line-height:1.6;margin-bottom:10px;">${et(locale, 'digest.adDesc')}</div>
      <a href="${APP_URL}/api/ad-click?slot=pro_banner&amp;src=email" style="display:inline-block;font-size:12.5px;font-weight:500;color:#ffffff;background:#1a1a1c;padding:8px 14px;border-radius:6px;text-decoration:none;">${et(locale, 'digest.adCta')}</a>
    </div>`
}

// 제휴 광고 슬롯 — 쿠팡 파트너스 카테고리 배너(날짜 로테이션).
// 고지 문구(확정형)는 라벨 바로 아래 — 본문과 동등한 크기로 확인하기 쉬운 위치에 둘 것(광고 표시 의무).
// 배너 링크는 /api/ad-click 경유 — 클릭 기록 후 제휴 링크(lib/ads.ts)로 302.
// 배너 내용이 날마다 바뀌므로 고정 텍스트(제목/설명/CTA)는 두지 않는다.
// img alt는 이미지 차단 환경에서 링크 텍스트 역할을 한다.
function partnerBlock(locale: EmailLocale, banner: PartnerBanner): string {
  return `
    <div style="padding:16px 20px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <div style="font-size:10px;color:#a0a0a4;letter-spacing:0.5px;margin-bottom:8px;">${et(locale, 'digest.adLabel')}</div>
      <div style="font-size:11px;color:#525252;line-height:1.6;margin-bottom:10px;">${et(locale, 'digest.partnerDisclosure')}</div>
      <a href="${APP_URL}/api/ad-click?slot=partner&amp;src=email&amp;dest=${banner.key}" target="_blank">
        <img src="${banner.img}" alt="${et(locale, 'digest.partnerCta')}" width="728" height="90" style="display:block;width:100%;max-width:728px;height:auto;border:0;border-radius:6px;margin-bottom:0;" />
      </a>
    </div>`
}

export function buildDigestHtml(
  items: EmailDigestItem[],
  userName: string,
  locale: EmailLocale = 'ko',
  email?: string,
  // 기본값 true = 광고 없음. 호출부가 무료임을 명시했을 때만 광고 노출(누락 시 안전).
  isPro = true
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
  // 광고 로테이션: KST 날짜의 일(day of month)이 짝수면 Pro 배너, 홀수면 제휴 슬롯.
  const kstDay = toZoned(nowUtc()).day
  const ad = isPro ? '' : (kstDay % 2 === 0 ? adBlock(locale) : partnerBlock(locale, partnerBannerByDay(kstDay)))
  return shell(et(locale, 'digest.subject', { date }), locale, header + body + ad, footerBlock(locale, email))
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
