import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminEmail } from '@/lib/route-auth'
import { getTranscript, summarizeVideo, type SummaryResult } from '@/lib/gemini'
import { getSummary } from '@/lib/video-pool'
import { sendDigestEmail } from '@/lib/mailer'
import { logApiUsage, SYSTEM_USER_ID } from '@/lib/api-usage'

// 관리자 단건 요약 도구 — 유튜브 주소 하나를 받아 요약해서 관리자 본인에게 메일로 보낸다.
// 정식 기능이 아니라 관리자가 가끔 쓰는 내부 도구다.
//
// 설계 원칙: 새 요약 로직을 만들지 않는다. 기존 부품(getTranscript → summarizeVideo →
// sendDigestEmail)을 순서대로 부르기만 한다.
//
// 사용자 데이터에 영향을 주지 않는다:
//  - 열람 기록(digests)에 쓰지 않는다 → 대시보드의 읽음 표시·히스토리가 흔들리지 않는다.
//  - 공유 풀(videos)에 새 행을 만들지 않는다 → 정기 수집 대상이 늘지 않는다.
//  - logType='admin' → 정기 발송 중복 판정(send-guard)과 환불 자격 판정
//    (lib/refund-eligibility.ts의 digest/breaking/preview)에서 모두 빠진다.
//  - summarizeVideo의 userId는 null → 개인 사용량이 아니라 시스템 계정(SYSTEM_USER_ID)에 잡힌다.

export const maxDuration = 60

// 메일 본문에 쓸 기본 메타. 채널 별칭·카테고리는 사용자 설정에서 오는 값이라
// 단건 도구에는 없다 → 발송 경로들이 쓰는 것과 같은 폴백 값을 쓴다.
const DEFAULT_EMOJI = '📺'
const DEFAULT_CATEGORY = '미분류'

// 유튜브 영상 ID는 11자 [A-Za-z0-9_-].
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

// 주소에서 videoId 추출. youtu.be/xxx, watch?v=xxx, /shorts/xxx, /live/xxx 를 모두 받는다.
// (/embed/xxx, /v/xxx, ID만 붙여넣기도 같은 규칙으로 처리된다)
function extractVideoId(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null
  // 주소가 아니라 ID만 붙여넣은 경우
  if (VIDEO_ID_RE.test(input)) return input

  // 스킴 없이 'youtu.be/xxx'만 붙여넣어도 URL로 파싱되게 한다.
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const isYoutubeHost =
    host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtu.be'
  if (!isYoutubeHost) return null

  const valid = (id: string | undefined | null): string | null => (id && VIDEO_ID_RE.test(id) ? id : null)

  // 단축 주소: youtu.be/<id>
  if (host === 'youtu.be') return valid(url.pathname.split('/')[1])

  // 일반 주소: /watch?v=<id> (다른 경로에 v=가 붙어도 그게 영상 ID다)
  const v = url.searchParams.get('v')
  if (v) return valid(v)

  // 경로형: /shorts/<id>, /live/<id>, /embed/<id>, /v/<id>
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(segments[0])) {
    return valid(segments[1])
  }
  return null
}

type VideoInfo = { title: string; channelTitle: string; publishedAt: string }

// 영상 제목·채널명 조회. lib/youtube.ts에는 videoId로 영상 정보를 가져오는 함수가 없고
// (getChannelId만 있다), getTranscript는 설명만 돌려주고 제목·채널명은 노출하지 않는다
// → 여기서 videos?part=snippet을 1회 호출한다(할당량 1 unit). 기존 fetch 방식 그대로.
async function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  // Cloudflare 호환: env는 함수 내부에서 읽는다.
  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`
    )
    // 공유 풀 작업과 같은 기준: userId가 없는 호출은 시스템 계정으로 귀속해 기록한다.
    await logApiUsage(SYSTEM_USER_ID, 'youtube')
    const data = await res.json()
    if (!res.ok || data.error) {
      console.error(`[admin/summarize-one] videos.list 오류: ${data.error?.message ?? res.status}`)
      return null
    }
    const snippet = data.items?.[0]?.snippet
    // items가 비어 있으면 비공개/삭제 영상이다.
    if (!snippet) return null
    return {
      title: snippet.title ?? '',
      channelTitle: snippet.channelTitle ?? '채널',
      publishedAt: snippet.publishedAt ?? new Date().toISOString(),
    }
  } catch (e) {
    console.error('[admin/summarize-one] videos.list 실패:', e)
    return null
  }
}

// 외부(유튜브·메일) 원문 오류 메시지는 내보내지 않는다 — 로그에만 남기고 짧은 코드만 돌려준다.
function fail(code: string, status: number) {
  return NextResponse.json({ ok: false, error: code }, { status })
}

export async function POST(request: Request) {
  // 관리자 권한 확인 — ADMIN_EMAILS 대조. route-auth의 헬퍼가 env를 함수 내부에서 읽는다.
  const user = await getAuthedUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const videoId = extractVideoId(typeof body?.url === 'string' ? body.url : '')
  if (!videoId) return fail('bad_url', 400)

  // 제목·채널명을 먼저 조회한다. 비공개/삭제 영상을 여기서 걸러야 자막 API(Supadata)를
  // 헛되이 호출하지 않는다 — 실패해도 크레딧이 차감되기 때문이다.
  const info = await fetchVideoInfo(videoId)
  if (!info) return fail('no_video', 404)

  // 이미 요약이 있으면 재사용한다. 같은 영상을 두 번 요약하면 비용만 든다.
  const existing = await getSummary(videoId, 'ko')
  let summary: SummaryResult
  let reused = false

  if (existing) {
    reused = true
    summary = {
      summary: existing.summary ?? '',
      // 풀(JSONB)에서 온 값이 배열이 아닐 수 있음 → 메일 렌더의 .map() TypeError 방지
      keyPoints: Array.isArray(existing.key_points) ? existing.key_points : [],
      timeline: Array.isArray(existing.timeline) ? existing.timeline : [],
      summaryBasis: existing.summary_basis ?? '요약',
      model: existing.model ?? undefined,
    }
  } else {
    const tr = await getTranscript(videoId) // userId 없음 → 사용량은 시스템 계정에 기록
    if (tr.unavailable) return fail('no_video', 404)

    // 자막 확보 실패(크레딧 소진·API 오류)면 설명으로 대체 요약하지 않는다.
    // 정기 경로(summarizeAndStore)와 같은 판단이다 — 우리 쪽 사정으로 저품질 요약을
    // 만들어 두면 크레딧이 복구돼도 그 영상은 계속 그 요약으로 남는다.
    const exhausted = tr.transcriptExhausted === true
    if (!tr.transcript && exhausted) return fail('no_transcript', 502)

    summary = await summarizeVideo(null, info.title, tr.transcript, tr.description, 'ko', {
      transcriptExhausted: exhausted,
    })
    // 일시적 실패는 가짜 성공 객체로 돌아온다 → 저장도 발송도 하지 않는다.
    if (summary.errorInfo || summary.summaryBasis === '요약 실패') {
      console.error(`[admin/summarize-one] 요약 실패 (${videoId}): ${summary.errorInfo ?? summary.summaryBasis}`)
      return fail('summarize_failed', 502)
    }

    await storeSummaryIfPooled(videoId, summary)
  }

  // 관리자 본인에게 발송. logType='admin'이라 정기 발송 중복 판정과 환불 자격 판정에서 빠진다.
  try {
    await sendDigestEmail(
      user.email,
      'Admin',
      [
        {
          channel: info.channelTitle,
          category: DEFAULT_CATEGORY,
          emoji: DEFAULT_EMOJI,
          video: {
            videoId,
            title: info.title,
            publishedAt: info.publishedAt,
            channelTitle: info.channelTitle,
            url: `https://youtube.com/watch?v=${videoId}`,
          },
          summary,
        },
      ],
      'ko',
      null,   // userId — 개인 발송 통계에 잡히지 않게
      true,   // isPro — 광고 없이
      'admin' // logType
    )
  } catch (e) {
    console.error(`[admin/summarize-one] 발송 실패 (${videoId}):`, e)
    return fail('send_failed', 502)
  }

  return NextResponse.json({ ok: true, title: info.title, reused })
}

// 새로 만든 요약을 기존 저장 경로(video_summaries)에 남긴다 — 같은 영상을 다음에 또
// 요약하지 않기 위해서다. 단, 아래 두 경우엔 저장하지 않는다:
//
//  1. 공유 풀(videos)에 없는 영상 — video_summaries.video_id는 videos(video_id)를 참조하는
//     외래키라(sql/shared_video_pool_v2.sql) 풀에 행이 없으면 INSERT 자체가 실패한다.
//     풀에 행을 새로 만드는 것은 이 도구의 범위 밖이다(정기 수집 대상이 늘어난다).
//  2. 라이브/예정으로 표시된 영상 — 방송 중 자막은 일부뿐이라 그 요약을 풀에 남기면
//     정기 경로가 다시는 요약하지 않아(요약이 있는 영상은 대상에서 빠진다) 방송이 끝난 뒤에도
//     반쪽 요약이 그대로 남는다.
//
// 저장에 실패해도 발송은 그대로 이어진다 — 비용 절약용 캐시일 뿐이라 흐름을 막지 않는다.
// videos 테이블은 읽기만 하고 쓰지 않는다(fail_reason 등은 요약이 없을 때만 읽히는 값이라
// 정리하지 않아도 사용자에게 보이는 동작은 달라지지 않는다).
async function storeSummaryIfPooled(videoId: string, result: SummaryResult): Promise<void> {
  // Cloudflare 호환: env는 함수 내부에서 읽는다.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!
  const service = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: pooled, error: lookupError } = await service
    .from('videos')
    .select('video_id, live_broadcast_content, fail_reason')
    .eq('video_id', videoId)
    .maybeSingle()
  if (lookupError) {
    console.error(`[admin/summarize-one] 풀 조회 실패 → 저장 생략 (${videoId}): ${lookupError.message}`)
    return
  }
  if (!pooled) {
    console.log(`[admin/summarize-one] 공유 풀에 없는 영상 → 요약 저장 생략 (${videoId})`)
    return
  }
  const live = pooled.live_broadcast_content
  if (live === 'live' || live === 'upcoming' || pooled.fail_reason === 'live') {
    console.log(`[admin/summarize-one] 라이브/예정 영상 → 요약 저장 생략 (${videoId})`)
    return
  }

  // 컬럼 구성은 정기 경로(lib/video-pool.ts의 summarizeAndStore)와 같게 맞춘다.
  const { error } = await service.from('video_summaries').upsert(
    {
      video_id: videoId,
      locale: 'ko',
      tldr: result.tldr ?? '',
      summary: result.summary,
      key_points: Array.isArray(result.keyPoints) ? result.keyPoints : [], // JSONB 배열로 정규화
      timeline: Array.isArray(result.timeline) ? result.timeline : [],     // JSONB 배열로 정규화
      model: result.model ?? null,
      summary_basis: result.summaryBasis ?? null,
    },
    { onConflict: 'video_id,locale' }
  )
  if (error) console.error(`[admin/summarize-one] video_summaries 적재 실패 (${videoId}): ${error.message}`)
}
