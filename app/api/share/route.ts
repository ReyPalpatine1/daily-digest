import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createShare } from '@/lib/share'

// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로(요청 시점에 채워짐)
// env는 이 함수를 호출하는 핸들러 안에서 읽어 넘긴다. (feedback route와 동일 패턴)
async function getAuthedUser(supabaseUrl: string, supabaseAnonKey: string) {
  const cookieStore = await cookies()
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // 무시
        }
      },
    },
  })
  const { data: { user }, error } = await authClient.auth.getUser()
  return error || !user ? null : user
}

// 공유 링크 생성 — 로그인 사용자만. (다량 생성 방지는 우선 로그인 필수로만 제한, 정교한 rate limit은 백로그)
export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailyvideodigest.com').replace(/\/+$/, '')

  const user = await getAuthedUser(supabaseUrl, supabaseAnonKey)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    videoId?: string
    comment?: string
    highlightTime?: string
    showName?: boolean
  }

  // videoId: 필수 (YouTube ID — 영문/숫자/-/_ 만, 상한 32자로 방어)
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : ''
  if (!videoId || videoId.length > 32 || !/^[\w-]+$/.test(videoId)) {
    return NextResponse.json({ error: 'invalid_video_id' }, { status: 400 })
  }

  try {
    const token = await createShare({
      videoId,
      sharedBy: user.id,
      comment: typeof body.comment === 'string' ? body.comment : undefined,
      highlightTime: typeof body.highlightTime === 'string' ? body.highlightTime : undefined,
      showName: body.showName !== false, // 기본 true
    })
    return NextResponse.json({ token, url: `${appUrl}/s/${token}` })
  } catch (e) {
    console.error('[share] 공유 생성 실패:', e)
    return NextResponse.json({ error: 'share_failed' }, { status: 500 })
  }
}
