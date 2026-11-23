// 개인정보처리방침 버전·시행일 전환·개정 공지 (클라이언트·서버 공용, env 사용 없음).
//
// ★ 현재 시각 비교는 반드시 함수 안에서 한다(모듈 최상단에서 Date.now()를 읽지 말 것) —
//   빌드·모듈 로드 시점의 시각으로 고정되면 시행일이 지나도 바뀌지 않는다.
import {
  PRIVACY_KO, PRIVACY_EN, PRIVACY_JA, PRIVACY_ZH,
  PRIVACY_KO_20260714, PRIVACY_EN_20260714, PRIVACY_JA_20260714, PRIVACY_ZH_20260714,
} from './content'

export type PrivacyLang = 'ko' | 'en' | 'ja' | 'zh'
export type PrivacyVersion = '2026-07-14' | '2026-12-01'

export const PRIVACY_PREVIOUS_VERSION: PrivacyVersion = '2026-07-14'
export const PRIVACY_AMENDED_VERSION: PrivacyVersion = '2026-12-01'

// 개정 방침 시행 시각: 2026-12-01 00:00 KST.
const AMENDED_EFFECTIVE_MS = Date.parse('2026-12-01T00:00:00+09:00')
// 개정 공지 노출 기간: 2026-11-24 00:00 ~ 2026-11-30 23:59 KST (끝은 12-01 00:00 직전까지).
const NOTICE_START_MS = Date.parse('2026-11-24T00:00:00+09:00')
const NOTICE_END_MS = AMENDED_EFFECTIVE_MS

export const PRIVACY_BODIES: Record<PrivacyVersion, Record<PrivacyLang, string>> = {
  '2026-07-14': { ko: PRIVACY_KO_20260714, en: PRIVACY_EN_20260714, ja: PRIVACY_JA_20260714, zh: PRIVACY_ZH_20260714 },
  '2026-12-01': { ko: PRIVACY_KO, en: PRIVACY_EN, ja: PRIVACY_JA, zh: PRIVACY_ZH },
}

export function isPrivacyAmendmentEffective(nowMs: number = Date.now()): boolean {
  return nowMs >= AMENDED_EFFECTIVE_MS
}

export function isPrivacyNoticeActive(nowMs: number = Date.now()): boolean {
  return nowMs >= NOTICE_START_MS && nowMs < NOTICE_END_MS
}

// 기본(?version 없음)으로 보여 줄 버전 — 시행일 전에는 개정 전 방침.
export function defaultPrivacyVersion(nowMs: number = Date.now()): PrivacyVersion {
  return isPrivacyAmendmentEffective(nowMs) ? PRIVACY_AMENDED_VERSION : PRIVACY_PREVIOUS_VERSION
}

// ?version= 값 해석. 알 수 없는 값이면 null(기본 버전으로 처리).
export function parsePrivacyVersion(v: string | null | undefined): PrivacyVersion | null {
  return v === '2026-07-14' || v === '2026-12-01' ? v : null
}

// /privacy 상단 개정 안내 문구.
export const PRIVACY_NOTICE: Record<PrivacyLang, string> = {
  ko: '개인정보처리방침이 2026년 12월 1일부터 변경됩니다. 유료 결제 시 보관하는 정보(자동결제용 빌링키, 카드사명 및 마스킹된 카드번호 끝 4자리 등)를 구체적으로 적고, 결제대행사 위탁 내용을 정정했습니다. 수집하는 정보의 범위나 이용 목적은 달라지지 않습니다.',
  en: "Our Privacy Policy will change on December 1, 2026. We have specified the information retained upon paid payment (such as the billing key for automatic payments, the card issuer's name and the last 4 digits of the masked card number) and corrected the details of processing outsourced to our payment gateway. The scope of information collected and the purposes of use remain unchanged.",
  ja: 'プライバシーポリシーを2026年12月1日に改定します。有料決済時に保管する情報（自動決済用のビリングキー、カード会社名、マスキングされたカード番号の下4桁等）を具体的に記載し、決済代行会社への委託内容を訂正しました。収集する情報の範囲および利用目的に変更はありません。',
  zh: '本隐私政策将于 2026 年 12 月 1 日起变更。我们具体列明了付费付款时保存的信息（如用于自动扣款的账单密钥、发卡机构名称及经掩码处理的卡号后 4 位等），并更正了对支付代理机构的委托内容。收集信息的范围及使用目的不变。',
}

// /privacy 하단 버전 링크 문구.
export const PRIVACY_LINK_LABELS: Record<PrivacyLang, { previous: string; preview: string }> = {
  ko: { previous: '개정 전 방침(2026-07-14)', preview: '개정 방침 미리 보기' },
  en: { previous: 'Previous version (2026-07-14)', preview: 'Preview the amended policy' },
  ja: { previous: '改正前のポリシー（2026-07-14）', preview: '改正後のポリシーを見る' },
  zh: { previous: '修订前的政策（2026-07-14）', preview: '预览修订后的政策' },
}
