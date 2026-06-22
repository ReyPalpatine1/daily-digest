// 발송 채널 정의 — 단일 소스(Single Source of Truth).
// 채널 추가/제거/순서변경/활성화는 전부 아래 CHANNELS 배열만 수정하면 된다.
// 실제 발송 구현 여부는 enabled 로 표시(현재 email/telegram 만 true).

import type { Settings } from './supabase'

export type ChannelId = 'email' | 'telegram' | 'whatsapp' | 'line' | 'kakao'

// 주소를 저장하는 settings 컬럼명 (email→email, telegram→telegram_chat_id 등)
export type ChannelAddressField = keyof Pick<
  Settings,
  'email' | 'telegram_chat_id' | 'whatsapp_number' | 'line_user_id' | 'kakao_user_id'
>

export type ChannelDef = {
  id: ChannelId
  labelKey: string // i18n 키 (예: 'channels.email')
  icon: string // 아이콘 식별자(프론트에서 매핑)
  enabled: boolean // 실제 작동 여부 (email/telegram=true, 나머지=false 준비중)
  proOnly: boolean // PRO 전용 여부 (email=false, 나머지=true)
  addressField: ChannelAddressField | null
  regionLocales?: string[] // 이 채널을 상단 우선노출할 언어(예: kakao→['ko'])
}

export const CHANNELS: ChannelDef[] = [
  { id: 'email', labelKey: 'channels.email', icon: 'mail', enabled: true, proOnly: false, addressField: 'email' },
  { id: 'telegram', labelKey: 'channels.telegram', icon: 'telegram', enabled: true, proOnly: true, addressField: 'telegram_chat_id' },
  { id: 'kakao', labelKey: 'channels.kakao', icon: 'kakao', enabled: false, proOnly: true, addressField: 'kakao_user_id', regionLocales: ['ko'] },
  { id: 'whatsapp', labelKey: 'channels.whatsapp', icon: 'whatsapp', enabled: false, proOnly: true, addressField: 'whatsapp_number', regionLocales: ['en', 'zh'] },
  { id: 'line', labelKey: 'channels.line', icon: 'line', enabled: false, proOnly: true, addressField: 'line_user_id', regionLocales: ['ja'] },
]

// 빠른 조회용 맵
export function getChannel(id: ChannelId): ChannelDef | undefined {
  return CHANNELS.find(c => c.id === id)
}

// 언어별 정렬: email 항상 맨 위 → 해당 locale의 regionLocales 채널 → telegram(글로벌) → 나머지.
export function orderedChannels(locale: string): ChannelDef[] {
  const used = new Set<ChannelId>()
  const result: ChannelDef[] = []
  const push = (c?: ChannelDef) => {
    if (c && !used.has(c.id)) {
      used.add(c.id)
      result.push(c)
    }
  }

  // 1. email 항상 맨 위
  push(getChannel('email'))
  // 2. 이 locale을 우선노출 대상으로 가진 지역 채널 (telegram 제외)
  for (const c of CHANNELS) {
    if (c.id === 'email' || c.id === 'telegram') continue
    if (c.regionLocales?.includes(locale)) push(c)
  }
  // 3. telegram (글로벌)
  push(getChannel('telegram'))
  // 4. 나머지 (CHANNELS 정의 순서)
  for (const c of CHANNELS) push(c)

  return result
}
