// 4a단계: 채널 공유 구조용 헬퍼 (설계/진단 단계).
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
// ⚠️ 아직 발송 흐름에 연결되지 않음. 4b(수집)에서 사용 예정.
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export type UniqueChannel = {
  channelId: string
  uploadsPlaylistId: string | null
}

// 활성 사용자들이 구독한 "고유 채널" 목록 (중복 제거).
// 같은 채널을 N명이 구독해도 1번만 조회하기 위한 수집 대상 산출용.
//   - 활성 사용자(settings.active=true)의
//   - 활성 채널(is_active != false)이면서 channel_id가 채워진 것만
//   - channel_id 기준 DISTINCT
export async function getUniqueChannels(): Promise<UniqueChannel[]> {
  // 1) 활성 사용자 id
  const { data: activeSettings } = await supabase
    .from('settings')
    .select('user_id')
    .eq('active', true)

  const activeUserIds = (activeSettings ?? []).map(s => s.user_id)
  if (!activeUserIds.length) return []

  // 2) 활성 사용자들의 활성 채널 (channel_id 보유)
  const { data: channels } = await supabase
    .from('channels')
    .select('channel_id, uploads_playlist_id, is_active')
    .in('user_id', activeUserIds)

  // 3) channel_id 기준 DISTINCT (uploads_playlist_id는 있는 값 우선 보존)
  const byChannel = new Map<string, UniqueChannel>()
  for (const c of channels ?? []) {
    const channelId = (c as any).channel_id as string | null
    if (!channelId) continue
    if ((c as any).is_active === false) continue
    const uploadsPlaylistId = ((c as any).uploads_playlist_id as string | null) ?? null
    const existing = byChannel.get(channelId)
    if (!existing) {
      byChannel.set(channelId, { channelId, uploadsPlaylistId })
    } else if (!existing.uploadsPlaylistId && uploadsPlaylistId) {
      existing.uploadsPlaylistId = uploadsPlaylistId
    }
  }

  return [...byChannel.values()]
}
