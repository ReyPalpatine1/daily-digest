import { NextResponse } from 'next/server'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-link'
import { setAdConsent } from '@/lib/ad-consent'

// 광고 수신거부 (로그인 불필요, 서명 토큰).
// - POST: 실제 처리. 두 경로가 같은 처리를 쓴다.
//     · /unsubscribe 페이지가 열리면 클라이언트가 자동 호출 — JSON { t, action? }
//     · 메일 클라이언트의 원클릭 수신거부(RFC 8058) — List-Unsubscribe 헤더 주소(?t=)로
//       본문 "List-Unsubscribe=One-Click"(form) POST
//   action: 'resubscribe'면 다시 동의, 그 밖은 철회.
// - GET: 처리하지 않는다. 메일 보안 검사기의 링크 미리 열기로 철회되면 안 되므로
//   안내 페이지(/unsubscribe)로만 보낸다(그 페이지가 사람의 브라우저에서 POST를 보낸다).
// ★ 토큰 원문은 로그에 남기지 않는다.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const t = url.searchParams.get('t') ?? ''
  return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(t)}`, url.origin), 303)
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  let token = url.searchParams.get('t')
  let action: string | null = null

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null) as { t?: unknown; action?: unknown } | null
    if (typeof body?.t === 'string') token = body.t
    if (typeof body?.action === 'string') action = body.action
  }
  // 원클릭 요청(form 본문 List-Unsubscribe=One-Click)은 항상 철회로 처리한다.

  const userId = verifyUnsubscribeToken(token, 'ads')
  if (!userId) {
    return NextResponse.json({ error: 'invalid_link' }, { status: 400 })
  }

  const consent = action === 'resubscribe'
  const result = await setAdConsent(userId, consent, consent ? 'unsubscribe/resubscribe' : 'unsubscribe')
  if (!result.ok) {
    if (result.reason === 'no_profile') {
      return NextResponse.json({ error: 'invalid_link' }, { status: 400 })
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  return NextResponse.json({
    success: true,
    changed: result.changed,
    adConsent: result.adConsent,
    processedAt: result.processedAt,
    locale: result.locale,
  })
}
