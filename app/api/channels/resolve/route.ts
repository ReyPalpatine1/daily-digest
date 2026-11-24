import { NextResponse } from 'next/server'
import { getAuthedUserIdFast } from '@/lib/route-auth'
import { resolveChannel, channelTitleById } from '@/lib/youtube'

// 채널 추가 폼의 이름 칸 미리보기 — 입력한 주소를 채널로 해석해 { channelId, title }을 돌려준다.
// 채널 추가 API(/api/channels)와 같은 해석 함수(resolveChannel)를 쓴다. YouTube API 호출은
// 호출마다 logApiUsage로 기록되며, 응답 지연을 줄이려고 기록은 응답 뒤 after()로 실행한다
// (deferLog — OpenNext/Cloudflare에서 ctx.waitUntil로 완료 보장). 저장은 하지 않는다.
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

// 구간별 처리 시간(ms) — Server-Timing 헤더로 노출한다(값만, 개인정보 없음).
function timingHeaders(t: { auth: number; youtube?: number }): HeadersInit {
  const parts = [`auth;dur=${t.auth.toFixed(1)}`]
  if (t.youtube !== undefined) parts.push(`youtube;dur=${t.youtube.toFixed(1)}`)
  return { 'Server-Timing': parts.join(', ') }
}

export async function GET(req: Request) {
  // 로그인 확인은 로컬 JWT 검증(getClaims) — 공개 채널 제목만 돌려주는 미리보기라 Auth 서버 왕복을 생략한다.
  const authStart = performance.now()
  const userId = await getAuthedUserIdFast()
  const auth = performance.now() - authStart
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: timingHeaders({ auth }) })
  }

  const url = (new URL(req.url).searchParams.get('url') ?? '').trim()
  if (!url || url.length > 500) {
    return NextResponse.json({ error: 'invalid_channel_url' }, { status: 400, headers: timingHeaders({ auth }) })
  }

  if (!allow(userId)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: timingHeaders({ auth }) })
  }

  const ytStart = performance.now()
  const resolved = await resolveChannel(url, userId, { deferLog: true })
  if (!resolved) {
    const youtube = performance.now() - ytStart
    return NextResponse.json({ error: 'invalid_channel_url' }, { status: 400, headers: timingHeaders({ auth, youtube }) })
  }
  // /channel/UC... 주소는 해석에 API를 쓰지 않아 제목이 없다 — 추가 시(이름 비움)와 같게 제목을 1회 조회한다.
  const title = resolved.title ?? (await channelTitleById(resolved.channelId, userId, { deferLog: true }))
  const youtube = performance.now() - ytStart
  return NextResponse.json({ channelId: resolved.channelId, title }, { headers: timingHeaders({ auth, youtube }) })
}
