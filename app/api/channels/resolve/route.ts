import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/route-auth'
import { resolveChannel, channelTitleById } from '@/lib/youtube'

// 채널 추가 폼의 이름 칸 미리보기 — 입력한 주소를 채널로 해석해 { channelId, title }을 돌려준다.
// 채널 추가 API(/api/channels)와 같은 해석 함수(resolveChannel)를 쓴다. YouTube API 호출은
// resolveChannel 안에서 호출마다 logApiUsage로 기록된다. 저장은 하지 않는다.
//
// 과다 호출 제한: 사용자당 1분에 30회. Workers 인스턴스(isolate) 메모리에 두는 간단한 창 카운터라
// 인스턴스가 여러 개면 인스턴스별로 센다 — 정밀한 차단이 아니라 폭주 방지용이다.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 30
const hits = new Map<string, number[]>()

function allow(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter(ts => now - ts < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent)
    return false
  }
  recent.push(now)
  hits.set(userId, recent)
  // 메모리가 계속 늘지 않도록 가끔 오래된 사용자 항목을 정리한다.
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (!v.some(ts => now - ts < WINDOW_MS)) hits.delete(k)
  }
  return true
}

export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = (new URL(req.url).searchParams.get('url') ?? '').trim()
  if (!url || url.length > 500) {
    return NextResponse.json({ error: 'invalid_channel_url' }, { status: 400 })
  }

  if (!allow(user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const resolved = await resolveChannel(url, user.id)
  if (!resolved) {
    return NextResponse.json({ error: 'invalid_channel_url' }, { status: 400 })
  }
  // /channel/UC... 주소는 해석에 API를 쓰지 않아 제목이 없다 — 추가 시(이름 비움)와 같게 제목을 1회 조회한다.
  const title = resolved.title ?? (await channelTitleById(resolved.channelId, user.id))
  return NextResponse.json({ channelId: resolved.channelId, title })
}
