// 발송 디스패처 — settings.delivery_method 에 따라 채널을 골라 발송한다.
// 분기를 호출부에 흩뿌리지 않기 위해 여기 한 곳으로 모은다.
// 폴백 원칙: 선택 채널이 enabled=false 이거나 주소가 없으면 이메일로 안전 폴백(발송 누락 0).

import { sendDigestEmail, sendEmptyDigestEmail, sendBreakingAlert } from './mailer'
import { sendDigestTelegram, sendBreakingTelegram } from './telegram'
import { CHANNELS } from './channels'
import type { Settings } from './supabase'
import { SummaryResult } from './gemini'
import { VideoItem } from './youtube'

// mailer / telegram 발송 함수가 공통으로 받는 아이템 모양.
type DeliverItem = {
  channel: string
  category: string
  emoji: string
  video: VideoItem
  summary: SummaryResult
}

// 디스패처가 보는 settings 부분집합 (라우트는 전체 settings(any)를 그대로 넘김).
type DeliverySettings = Pick<Settings, 'email' | 'delivery_method' | 'telegram_chat_id'>

function isEnabled(method: string): boolean {
  return CHANNELS.some(c => c.id === method && c.enabled)
}

// 실제 사용할 채널 결정 — 무료/강등 사용자가 PRO 채널을 가리키면 이메일로 방어 폴백.
function effectiveMethod(method: string | null | undefined, isPro: boolean): string {
  const m = method ?? 'email'
  if (m !== 'email' && !isPro) return 'email'
  return m
}

export async function deliverDigest(
  settings: DeliverySettings,
  userName: string,
  items: DeliverItem[],
  locale: string | null = 'ko',
  userId: string | null = null,
  isPro = true
): Promise<void> {
  const method = effectiveMethod(settings.delivery_method, isPro)

  if (method === 'telegram' && isEnabled('telegram')) {
    const chatId = settings.telegram_chat_id
    if (chatId) {
      await sendDigestTelegram(chatId, userName, items, locale, userId)
      return
    }
    console.warn(`[delivery] telegram 선택됐으나 chat_id 미설정 → 이메일 폴백 (userId=${userId ?? '?'})`)
  }

  // email / 준비중 채널(whatsapp·line·kakao) / 주소 미설정 → 이메일 폴백
  await sendDigestEmail(settings.email, userName, items, locale, userId)
}

export async function deliverBreaking(
  settings: DeliverySettings,
  userName: string,
  item: DeliverItem,
  locale: string | null = 'ko',
  userId: string | null = null,
  isPro = true
): Promise<void> {
  const method = effectiveMethod(settings.delivery_method, isPro)

  if (method === 'telegram' && isEnabled('telegram')) {
    const chatId = settings.telegram_chat_id
    if (chatId) {
      await sendBreakingTelegram(chatId, userName, item, locale, userId)
      return
    }
    console.warn(`[delivery] telegram 선택됐으나 chat_id 미설정 → 이메일 폴백 (userId=${userId ?? '?'})`)
  }

  await sendBreakingAlert(settings.email, userName, item, locale, userId)
}

// 빈 다이제스트(새 영상 없음) 안내는 우선 이메일만 발송. 텔레그램 빈 안내는 생략.
export async function deliverEmptyDigest(
  settings: DeliverySettings,
  userName: string,
  locale: string | null = 'ko',
  userId: string | null = null
): Promise<void> {
  await sendEmptyDigestEmail(settings.email, userName, locale, userId)
}
