// 이메일 HTML 템플릿 (순수 함수 — nodemailer 의존성 없음).
// 서버(mailer.ts)와 클라이언트(admin/email-preview)에서 모두 import 가능.

import { et, type EmailLocale } from './i18n/email-translations'
import { nowUtc, toZoned } from './time'
import { youtubeDeepLink } from '@/lib/video-time'
import { partnerBannerByDay, type PartnerBanner } from '@/lib/ads'
import { boldMarkersToHtml, splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'
import { SUMMARY_BASIS_TRANSCRIPT_FAILED } from '@/lib/summary-basis'

export type { EmailLocale }

export type EmailDigestItem = {
  channel: string
  category: string
  emoji: string
  // videoId는 카드의 공유 링크(/dashboard?share=...) 생성에만 쓰인다.
  // 과거 호출부(videoId 없는 항목)에서도 깨지지 않도록 옵셔널 — 없으면 공유 링크를 생략한다.
  video: { title: string; url: string; publishedAt: string; videoId?: string }
  summary: {
    tldr?: string // 결론 한 줄(역피라미드 최상단, 라벨 없이 강조). 과거 데이터엔 없을 수 있어 옵셔널.
    summary: string
    keyPoints: string[]
    timeline: { time: string; content: string }[]
    summaryBasis?: string
    errorInfo?: string
    failReason?: string // no_source | temporary | pending | live | pro_only | transcript_failed — 실패·대기·라이브·Pro 전용·자막 확보 실패 항목 표기용
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
// 이 문구가 AI 부정확 고지를 겸하므로 텔레그램도 같은 매핑을 쓴다(문구가 갈리면 안 됨).
// 폐지된 '제목 기반 요약'을 비롯해 알 수 없는 값은 null → 표기를 아예 렌더하지 않는다
// (키 이름이나 빈 문자열이 노출되면 안 됨). lib/summary-basis.ts와 같은 원리.
export function basisTranslationKey(summaryBasis?: string): string | null {
  if (!summaryBasis) return null
  // '자막 확보 실패 기반 요약'도 '자막'을 포함하므로 아래 includes 판정보다 먼저 정확 일치로 거른다.
  if (summaryBasis === SUMMARY_BASIS_TRANSCRIPT_FAILED) return 'digest.basisTranscriptFailed'
  if (summaryBasis.includes('자막')) return 'digest.basisTranscript'
  if (summaryBasis.includes('설명')) return 'digest.basisDescription'
  return null
}

// fail_reason 코드 → 문구 번역 키(라벨+설명). 매칭 안 되면 null(정상 요약 표기).
// videos.fail_reason은 6종을 그대로 저장하되, 사용자에게 보이는 문구는 3종으로 묶는다
// (6종을 그대로 보여주면 사용자가 차이를 구분할 수 없다).
//   곧 반영됨 ← pending / live / transcript_failed
//   제공 불가 ← no_source / temporary
//   Pro 전용 ← pro_only
// ★ 열람 기록(dashboard summaryStatusKeys)과 반드시 같은 묶음·같은 문장을 쓸 것 —
//   갈라지면 "메일에서 열람 기록을 보라고 해서 갔더니 다른 말이 쓰여 있는" 상황이 된다.
//   그래서 메일도 한 줄로 줄이지 않고 라벨+설명 두 줄을 그대로 싣는다.
//   특히 '요약 준비 중'의 설명은 "이미 받은 메일에는 반영되지 않는다"를 알려 주는 핵심 정보라
//   메일에서 빼면 사용자가 같은 메일을 다시 확인하며 기다리게 된다.
// 발송 라우트(digest·preview)도 이 매핑을 그대로 쓴다 → 채널마다 묶음이 갈리지 않게 export.
export function failReasonTranslationKeys(
  failReason?: string
): { labelKey: string; noteKey: string } | null {
  if (failReason === 'pending' || failReason === 'live' || failReason === 'transcript_failed') {
    return { labelKey: 'digest.failPreparingLabel', noteKey: 'digest.failPreparingNote' }
  }
  if (failReason === 'no_source' || failReason === 'temporary') {
    return { labelKey: 'digest.failUnavailableLabel', noteKey: 'digest.failUnavailableNote' }
  }
  if (failReason === 'pro_only') {
    return { labelKey: 'digest.proOnlyLabel', noteKey: 'digest.proOnlyNote' }
  }
  return null
}

function digestCard(item: EmailDigestItem, locale: EmailLocale): string {
  const kp = safeArray<string>(item.summary.keyPoints)
  const tl = safeArray<{ time: string; content: string }>(item.summary.timeline)
  const basisKey = basisTranslationKey(item.summary.summaryBasis)
  const failKey = failReasonTranslationKeys(item.summary.failReason)
  // 공유 링크 — 대시보드에서 공유 시트를 여는 보조 버튼("영상 보기"와 같은 줄).
  // 실패·대기·라이브·pro_only 항목은 공유할 요약이 없으므로 넣지 않는다(대시보드 카드와 동일 기준).
  const shareLink = !failKey && item.video.videoId
    ? `<a href="${APP_URL}/dashboard?share=${encodeURIComponent(item.video.videoId)}" style="display:inline-block;padding:7px 14px;border:1px solid #E5E5E5;border-radius:6px;color:#525252;background:#FFFFFF;font-size:12px;font-weight:500;text-decoration:none;margin-left:8px;">${et(locale, 'digest.shareLink')}</a>`
    : ''
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
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:#1a1a1c;line-height:1.6;">${escapeHtml(et(locale, failKey.labelKey))}</div>
        <div style="font-size:11px;color:#8a8a8e;line-height:1.7;margin-top:3px;">${escapeHtml(et(locale, failKey.noteKey))}</div>
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
      </a>${shareLink}
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
// 배치 순서는 웹 광고 카드(components/AdCard.tsx)와 맞춘다: 라벨 → 배너 → 고지 문구.
// ★ 고지 문구(확정형)의 font-size 11px / color #525252 는 낮추지 말 것 —
//   공정위 추천·보증 심사지침상 경제적 이해관계 고지는 소비자가 쉽게 인식할 수 있어야 하는데,
//   위치가 배너 아래라 인식성이 이미 다소 떨어진다. 문구도 확정형 그대로 유지.
// 배너 링크는 /api/ad-click 경유 — 클릭 기록 후 제휴 링크(lib/ads.ts)로 302.
// 배너 내용이 날마다 바뀌므로 고정 텍스트(제목/설명/CTA)는 두지 않는다.
// img alt는 이미지 차단 환경에서 링크 텍스트 역할을 한다(고지 문구는 텍스트라 항상 보인다).
function partnerBlock(locale: EmailLocale, banner: PartnerBanner): string {
  return `
    <div style="padding:16px 20px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <div style="font-size:10px;color:#a0a0a4;letter-spacing:0.5px;margin-bottom:8px;">${et(locale, 'digest.adLabel')}</div>
      <a href="${APP_URL}/api/ad-click?slot=partner&amp;src=email&amp;dest=${banner.key}" target="_blank">
        <img src="${banner.img}" alt="${et(locale, 'digest.partnerCta')}" width="728" height="90" style="display:block;width:100%;max-width:728px;height:auto;border:0;border-radius:6px;margin-bottom:8px;" />
      </a>
      <div style="font-size:11px;color:#525252;line-height:1.6;margin-bottom:0;">${et(locale, 'digest.partnerDisclosure')}</div>
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

// 정기 갱신 결제 실패 안내. 카드 확인이 필요하므로 CTA는 구독 페이지가 아니라 프로필(카드 변경)로 보낸다.
export function buildRenewFailedHtml(locale: EmailLocale = 'ko'): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">💳</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'renewFailed.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'renewFailed.desc')}</div>
      <a href="${APP_URL}/profile" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'renewFailed.cta')}
      </a>
    </div>`
  return shell(et(locale, 'renewFailed.subject'), locale, inner, footerBlock(locale))
}

// 결제 3회 실패로 무료 강등된 뒤의 종료 안내.
export function buildSubEndedHtml(locale: EmailLocale = 'ko'): string {
  const inner = `
    <div style="background:#FFFFFF;border-radius:10px;padding:32px 24px;border:1px solid #E5E5E5;text-align:center;">
      <div style="width:56px;height:56px;background:#F4F4F5;border-radius:50%;display:inline-block;line-height:56px;font-size:26px;margin-bottom:16px;">📩</div>
      <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:8px;">${et(locale, 'subEnded.heading')}</div>
      <div style="font-size:13px;color:#71717A;line-height:1.7;margin-bottom:20px;">${et(locale, 'subEnded.desc')}</div>
      <a href="${APP_URL}/subscribe?mode=pay" style="display:inline-block;padding:10px 18px;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        ${et(locale, 'subEnded.cta')}
      </a>
    </div>`
  return shell(et(locale, 'subEnded.subject'), locale, inner, footerBlock(locale))
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

// 미리보기용 더미 데이터.
// ★ 관리자 미리보기 화면 전용 — 실제 발송 경로(mailer.ts·cron)는 이 함수를 쓰지 않는다.
// summaryBasis는 실제 발송물과 같은 근거 표기(= AI 고지)를 확인하려고 넣는다.
// 정상 카드 3종(자막/설명/자막 확보 실패)과 실패·대기·라이브·Pro 전용 카드를 모두 담아
// 문구를 고칠 때 모든 상태를 한 화면에서 확인할 수 있게 한다.
// ★ summaryBasis는 DB에 저장되는 한국어 문자열 그대로 둘 것 — 판정이 문자열 매칭이라
//   번역하면 근거 표기 분기가 깨진다(제목·요약·핵심 포인트만 각 언어로 옮긴다).
// 언어별 항목 구성(개수·상태 종류·videoId·발행 시각)은 동일하게 맞춘다.
// sample00003은 dummyBreakingItem이 쓰므로 여기서는 건너뛴다.
// 플랜별로 실제 발송에 나올 수 있는 조합만 남긴다 — 한 사용자가 동시에 볼 수 없는 카드가
// 한 화면에 섞이면 검수 도구로 쓸 수 없다. videoId로 고르므로 언어별 배열은 손대지 않는다.
//   Pro : 자막 기반 / 설명 기반(근거 라벨 노출) / 제공 불가 / 준비 중  → pro_only 없음
//   무료: 자막 기반 / 제공 불가 / Pro 전용 / 준비 중                  → 설명 기반 본문 없음
//        (무료에게 설명 기반 요약은 실제로 pro_only 카드로 나간다)
const PREVIEW_VIDEO_IDS: Record<'free' | 'pro', string[]> = {
  pro: ['sample00001', 'sample00002', 'sample00004', 'sample00008'],
  free: ['sample00001', 'sample00004', 'sample00007', 'sample00008'],
}

export function dummyDigestItems(locale: EmailLocale, plan: 'free' | 'pro' = 'pro'): EmailDigestItem[] {
  const allowed = new Set(PREVIEW_VIDEO_IDS[plan])
  return dummyDigestItemsAll(locale).filter(item => !!item.video.videoId && allowed.has(item.video.videoId))
}

function dummyDigestItemsAll(locale: EmailLocale): EmailDigestItem[] {
  // 카드마다 시간 표기가 다르게 보이도록 발행 시각을 벌려 둔다.
  const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString()

  if (locale === 'en') {
    return [
      {
        channel: 'Bloomberg', category: 'Economy', emoji: '📈',
        video: { videoId: 'sample00001', title: 'Fed Holds Rates Steady, Signals Caution', url: 'https://youtube.com', publishedAt: ago(0) },
        summary: {
          summary: 'The Federal Reserve kept interest rates unchanged, citing persistent inflation and a resilient labor market.',
          keyPoints: ['Rates unchanged at 5.25–5.50%', 'Inflation still above the 2% target', 'Two cuts projected later this year'],
          timeline: [{ time: '00:42', content: 'Opening statement from the chair' }, { time: '12:30', content: 'Q&A on the rate path' }],
          summaryBasis: '자동 생성 자막 기반 요약',
        },
      },
      {
        channel: 'Marques Brownlee', category: 'Tech', emoji: '🎬',
        video: { videoId: 'sample00002', title: 'The Best Phone Cameras of 2026', url: 'https://youtube.com', publishedAt: ago(2) },
        summary: {
          summary: 'A blind comparison of flagship phone cameras, ranking low-light and color accuracy across eight devices.',
          keyPoints: ['Low-light winner surprised everyone', 'Color science still varies widely'],
          timeline: [],
          summaryBasis: '영상 설명 기반 요약',
        },
      },
      {
        // 요약 실패 카드 — 근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
        channel: 'BBC News', category: 'World', emoji: '📰',
        video: { videoId: 'sample00004', title: 'Live: Parliament Debates the Budget', url: 'https://youtube.com', publishedAt: ago(3) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'no_source',
        },
      },
      {
        // 자막 확보 실패(크레딧 소진·API 오류)로 설명 대체된 요약 — Pro가 보는 화면.
        // 요약 본문은 그대로 나가고 근거 표기만 '자막을 불러오지 못해…'로 바뀌는지 확인하는 자리.
        channel: 'CNBC', category: 'Markets', emoji: '📊',
        video: { videoId: 'sample00005', title: 'Dollar Surges Past a Key Level — What Changes', url: 'https://youtube.com', publishedAt: ago(4) },
        summary: {
          summary: 'A rundown of what is driving the dollar rally and how exporters and importers are affected.',
          keyPoints: ['Rate differentials keep widening', 'Import costs are climbing'],
          timeline: [],
          summaryBasis: SUMMARY_BASIS_TRANSCRIPT_FAILED,
        },
      },
      // ↓ 실패·대기·라이브·Pro 전용 카드 — 위 no_source 카드와 마찬가지로
      //   근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
      {
        // 같은 자막 확보 실패지만 무료 사용자에게는 요약을 숨기고 사유만 표기한다.
        channel: 'Lex Fridman', category: 'Tech', emoji: '🎙',
        video: { videoId: 'sample00006', title: 'Semiconductor Outlook for the Second Half', url: 'https://youtube.com', publishedAt: ago(5) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'transcript_failed',
        },
      },
      {
        channel: 'Graham Stephan', category: 'Real Estate', emoji: '🏠',
        video: { videoId: 'sample00007', title: 'Zoning Reform: Which Neighborhoods Actually Benefit', url: 'https://youtube.com', publishedAt: ago(6) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'pro_only',
        },
      },
      {
        channel: 'Sky News', category: 'Society', emoji: '📺',
        video: { videoId: 'sample00008', title: 'Heavy Snow Warnings Across the Country', url: 'https://youtube.com', publishedAt: ago(9) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'pending',
        },
      },
      {
        channel: 'CNN', category: 'Politics', emoji: '🏛',
        video: { videoId: 'sample00009', title: 'Budget Talks Enter the Final Stretch', url: 'https://youtube.com', publishedAt: ago(12) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'temporary',
        },
      },
      {
        channel: 'C-SPAN', category: 'Politics', emoji: '🔴',
        video: { videoId: 'sample00010', title: 'LIVE: Oversight Hearing in Session', url: 'https://youtube.com', publishedAt: ago(17) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'live',
        },
      },
    ]
  }

  if (locale === 'zh') {
    return [
      {
        channel: '财新', category: '地缘政治', emoji: '📡',
        video: { videoId: 'sample00001', title: '中美元首通话，贸易紧张出现缓和信号', url: 'https://youtube.com', publishedAt: ago(0) },
        summary: {
          summary: '两国元首在通话中讨论了下调关税的可能性，贸易摩擦出现缓和氛围。',
          keyPoints: ['考虑分阶段下调关税', '就后续磋商日程达成一致', '市场立即作出积极反应'],
          timeline: [{ time: '00:30', content: '通话背景说明' }, { time: '05:10', content: '主要共识梳理' }],
          summaryBasis: '자동 생성 자막 기반 요약',
        },
      },
      {
        channel: '半导体观察', category: '经济', emoji: '💰',
        video: { videoId: 'sample00002', title: '半导体周期，现在是底部吗？', url: 'https://youtube.com', publishedAt: ago(2) },
        summary: {
          summary: '根据存储芯片的价格走势和库存指标，判断周期见底的可能性。',
          keyPoints: ['库存调整进入尾声', '预计下半年需求回暖'],
          timeline: [],
          summaryBasis: '영상 설명 기반 요약',
        },
      },
      {
        // 요약 실패 카드 — 근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
        channel: '新华社', category: '社会', emoji: '📰',
        video: { videoId: 'sample00004', title: '国会预算案审议现场直播', url: 'https://youtube.com', publishedAt: ago(3) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'no_source',
        },
      },
      {
        // 자막 확보 실패(크레딧 소진·API 오류)로 설명 대체된 요약 — Pro가 보는 화면.
        // 요약 본문은 그대로 나가고 근거 표기만 '자막을 불러오지 못해…'로 바뀌는지 확인하는 자리.
        channel: '第一财经', category: '经济', emoji: '📊',
        video: { videoId: 'sample00005', title: '汇率突破关键点位，会带来什么变化', url: 'https://youtube.com', publishedAt: ago(4) },
        summary: {
          summary: '梳理了汇率急升的背景，以及对进出口企业的影响。',
          keyPoints: ['美元走强与利差扩大', '进口物价上行压力'],
          timeline: [],
          summaryBasis: SUMMARY_BASIS_TRANSCRIPT_FAILED,
        },
      },
      // ↓ 실패·대기·라이브·Pro 전용 카드 — 위 no_source 카드와 마찬가지로
      //   근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
      {
        // 같은 자막 확보 실패지만 무료 사용자에게는 요약을 숨기고 사유만 표기한다.
        channel: '科技早知道', category: '经济', emoji: '🎙',
        video: { videoId: 'sample00006', title: '半导体行情检视 — 下半年展望', url: 'https://youtube.com', publishedAt: ago(5) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'transcript_failed',
        },
      },
      {
        channel: '房产观察', category: '房产', emoji: '🏠',
        video: { videoId: 'sample00007', title: '重建规制放宽，实际受益的小区有哪些', url: 'https://youtube.com', publishedAt: ago(6) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'pro_only',
        },
      },
      {
        channel: '央视新闻', category: '社会', emoji: '📺',
        video: { videoId: 'sample00008', title: '全国发布大雪预警，早高峰交通情况', url: 'https://youtube.com', publishedAt: ago(9) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'pending',
        },
      },
      {
        channel: '凤凰卫视', category: '政治', emoji: '🏛',
        video: { videoId: 'sample00009', title: '朝野预算谈判进入最后阶段', url: 'https://youtube.com', publishedAt: ago(12) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'temporary',
        },
      },
      {
        channel: '直播中国', category: '社会', emoji: '🔴',
        video: { videoId: 'sample00010', title: '【直播】国政监查现场', url: 'https://youtube.com', publishedAt: ago(17) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'live',
        },
      },
    ]
  }

  if (locale === 'ja') {
    return [
      {
        channel: 'テレ東BIZ', category: '地政学', emoji: '📡',
        video: { videoId: 'sample00001', title: '米中首脳の電話会談、貿易摩擦の緩和シグナル', url: 'https://youtube.com', publishedAt: ago(0) },
        summary: {
          summary: '両国首脳が電話会談で関税引き下げの可能性を協議し、貿易摩擦の緩和ムードが生まれました。',
          keyPoints: ['関税の段階的な引き下げを検討', '実務協議の日程で合意', '市場は即座に好反応'],
          timeline: [{ time: '00:30', content: '会談の背景説明' }, { time: '05:10', content: '主な合意内容の整理' }],
          summaryBasis: '자동 생성 자막 기반 요약',
        },
      },
      {
        channel: '日経チャンネル', category: '経済', emoji: '💰',
        video: { videoId: 'sample00002', title: '半導体サイクル、今が底値か？', url: 'https://youtube.com', publishedAt: ago(2) },
        summary: {
          summary: 'メモリ半導体の価格動向と在庫指標をもとに、サイクルの底打ちの可能性を分析しました。',
          keyPoints: ['在庫調整は最終局面', '下期の需要回復に期待'],
          timeline: [],
          summaryBasis: '영상 설명 기반 요약',
        },
      },
      {
        // 요약 실패 카드 — 근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
        channel: 'NHKニュース', category: '社会', emoji: '📰',
        video: { videoId: 'sample00004', title: '国会予算案の審議を生中継', url: 'https://youtube.com', publishedAt: ago(3) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'no_source',
        },
      },
      {
        // 자막 확보 실패(크레딧 소진·API 오류)로 설명 대체된 요약 — Pro가 보는 화면.
        // 요약 본문은 그대로 나가고 근거 표기만 '자막을 불러오지 못해…'로 바뀌는지 확인하는 자리.
        channel: 'TBS NEWS', category: '経済', emoji: '📊',
        video: { videoId: 'sample00005', title: '円相場が節目を突破、何が変わるのか', url: 'https://youtube.com', publishedAt: ago(4) },
        summary: {
          summary: '為替の急変動の背景と、輸出入企業への影響を整理しました。',
          keyPoints: ['ドル高と金利差の拡大', '輸入物価の上昇圧力'],
          timeline: [],
          summaryBasis: SUMMARY_BASIS_TRANSCRIPT_FAILED,
        },
      },
      // ↓ 실패·대기·라이브·Pro 전용 카드 — 위 no_source 카드와 마찬가지로
      //   근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
      {
        // 같은 자막 확보 실패지만 무료 사용자에게는 요약을 숨기고 사유만 표기한다.
        channel: 'PIVOT', category: '経済', emoji: '🎙',
        video: { videoId: 'sample00006', title: '半導体市況の点検 — 下期の見通し', url: 'https://youtube.com', publishedAt: ago(5) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'transcript_failed',
        },
      },
      {
        channel: '不動産チャンネル', category: '不動産', emoji: '🏠',
        video: { videoId: 'sample00007', title: '再開発規制の緩和、実際に恩恵を受ける物件は', url: 'https://youtube.com', publishedAt: ago(6) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'pro_only',
        },
      },
      {
        channel: 'ANNnews', category: '社会', emoji: '📺',
        video: { videoId: 'sample00008', title: '全国で大雪警報、通勤時間帯の交通状況', url: 'https://youtube.com', publishedAt: ago(9) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'pending',
        },
      },
      {
        channel: 'FNNプライム', category: '政治', emoji: '🏛',
        video: { videoId: 'sample00009', title: '与野党の予算協議が最終局面に', url: 'https://youtube.com', publishedAt: ago(12) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'temporary',
        },
      },
      {
        channel: 'ライブ中継', category: '社会', emoji: '🔴',
        video: { videoId: 'sample00010', title: '【LIVE】国政調査の現場中継', url: 'https://youtube.com', publishedAt: ago(17) },
        summary: {
          summary: '', keyPoints: [], timeline: [],
          failReason: 'live',
        },
      },
    ]
  }

  return [
    {
      channel: 'YTN', category: '지정학', emoji: '📡',
      video: { videoId: 'sample00001', title: '미·중 정상 통화, 무역 긴장 완화 신호', url: 'https://youtube.com', publishedAt: ago(0) },
      summary: {
        summary: '양국 정상이 통화에서 관세 인하 가능성을 논의하며 무역 갈등 완화 분위기가 형성됐습니다.',
        keyPoints: ['관세 단계적 인하 검토', '추가 실무 협상 일정 합의', '시장은 즉시 긍정 반응'],
        timeline: [{ time: '00:30', content: '통화 배경 설명' }, { time: '05:10', content: '주요 합의 내용 정리' }],
        summaryBasis: '자동 생성 자막 기반 요약',
      },
    },
    {
      channel: '소수몽키', category: '경제', emoji: '💰',
      video: { videoId: 'sample00002', title: '반도체 사이클, 지금이 저점일까?', url: 'https://youtube.com', publishedAt: ago(2) },
      summary: {
        summary: '메모리 반도체 가격 흐름과 재고 지표를 근거로 사이클 저점 가능성을 진단했습니다.',
        keyPoints: ['재고 조정 막바지 국면', '하반기 수요 회복 기대'],
        timeline: [],
        summaryBasis: '영상 설명 기반 요약',
      },
    },
    {
      // 요약 실패 카드 — 근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
      channel: '연합뉴스TV', category: '사회', emoji: '📰',
      video: { videoId: 'sample00004', title: '국회 예산안 심사 생중계', url: 'https://youtube.com', publishedAt: ago(3) },
      summary: {
        summary: '', keyPoints: [], timeline: [],
        failReason: 'no_source',
      },
    },
    {
      // 자막 확보 실패(크레딧 소진·API 오류)로 설명 대체된 요약 — Pro가 보는 화면.
      // 요약 본문은 그대로 나가고 근거 표기만 '자막을 불러오지 못해…'로 바뀌는지 확인하는 자리.
      channel: '슈카월드', category: '경제', emoji: '📊',
      video: { videoId: 'sample00005', title: '환율 1,400원 돌파, 무엇이 달라지나', url: 'https://youtube.com', publishedAt: ago(4) },
      summary: {
        summary: '환율 급등의 배경과 수출입 기업이 받는 영향을 정리했습니다.',
        keyPoints: ['달러 강세와 금리차 확대', '수입 물가 상승 압력'],
        timeline: [],
        summaryBasis: SUMMARY_BASIS_TRANSCRIPT_FAILED,
      },
    },
    // ↓ 실패·대기·라이브·Pro 전용 카드 — 위 no_source 카드와 마찬가지로
    //   근거 표기(AI 고지)와 공유 버튼이 붙지 않는 것도 함께 확인하는 자리.
    {
      // 같은 자막 확보 실패지만 무료 사용자에게는 요약을 숨기고 사유만 표기한다.
      channel: '삼프로TV', category: '경제', emoji: '🎙',
      video: { videoId: 'sample00006', title: '반도체 업황 점검 — 하반기 전망', url: 'https://youtube.com', publishedAt: ago(5) },
      summary: {
        summary: '', keyPoints: [], timeline: [],
        failReason: 'transcript_failed',
      },
    },
    {
      channel: '부읽남TV', category: '부동산', emoji: '🏠',
      video: { videoId: 'sample00007', title: '재건축 규제 완화, 실제 수혜 단지는', url: 'https://youtube.com', publishedAt: ago(6) },
      summary: {
        summary: '', keyPoints: [], timeline: [],
        failReason: 'pro_only',
      },
    },
    {
      channel: 'MBC뉴스', category: '사회', emoji: '📺',
      video: { videoId: 'sample00008', title: '전국 대설특보, 출근길 교통 상황', url: 'https://youtube.com', publishedAt: ago(9) },
      summary: {
        summary: '', keyPoints: [], timeline: [],
        failReason: 'pending',
      },
    },
    {
      channel: 'KBS 뉴스', category: '정치', emoji: '🏛',
      video: { videoId: 'sample00009', title: '여야 예산안 협상 최종 국면', url: 'https://youtube.com', publishedAt: ago(12) },
      summary: {
        summary: '', keyPoints: [], timeline: [],
        failReason: 'temporary',
      },
    },
    {
      channel: 'SBS 뉴스', category: '사회', emoji: '🔴',
      video: { videoId: 'sample00010', title: '[LIVE] 국정감사 현장 생중계', url: 'https://youtube.com', publishedAt: ago(17) },
      summary: {
        summary: '', keyPoints: [], timeline: [],
        failReason: 'live',
      },
    },
  ]
}

export function dummyBreakingItem(locale: EmailLocale): EmailDigestItem {
  if (locale === 'en') {
    return {
      channel: 'Reuters', category: 'Markets', emoji: '⚡',
      video: { videoId: 'sample00003', title: 'Breaking: Major Index Drops 3% on Rate Fears', url: 'https://youtube.com', publishedAt: new Date().toISOString() },
      summary: {
        summary: 'Equity markets fell sharply after stronger-than-expected inflation data renewed rate-hike concerns.',
        keyPoints: ['Index down 3% intraday', 'Bond yields spiked'],
        timeline: [],
        summaryBasis: '자동 생성 자막 기반 요약',
      },
    }
  }
  return {
    channel: '부읽남TV', category: '재테크', emoji: '🚨',
    video: { videoId: 'sample00003', title: '속보: 삼성전자 실적 발표, 시장 예상 상회', url: 'https://youtube.com', publishedAt: new Date().toISOString() },
    summary: {
      summary: '삼성전자가 시장 예상을 웃도는 분기 실적을 발표하며 주가가 장중 강세를 보였습니다.',
      keyPoints: ['영업이익 컨센서스 상회', '반도체 부문 회복 뚜렷'],
      timeline: [],
      summaryBasis: '자동 생성 자막 기반 요약',
    },
  }
}
