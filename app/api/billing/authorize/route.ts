import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'

// 토스 카드 등록(빌링키 발급) — 결제창에서 받은 authKey를 빌링키로 교환해 저장한다.
// 이 라우트에서 실제 결제는 일어나지 않는다(카드 등록까지만).
//
// 보안 메모
// - 빌링키는 클라이언트가 알 필요가 없는 민감값이라 profiles가 아니라 RLS 정책이 없는
//   billing_keys(서비스 롤 전용)에 넣는다.
// - customerKey는 세션 사용자의 UUID여야 한다 — 남의 authKey로 남의 계정에 카드를 붙이는 것을 막는다.
// - 시크릿 키·빌링키 원문은 응답에도 로그에도 남기지 않는다.
//
// Cloudflare Workers는 모듈 로드 시점에 process.env가 비어 있으므로 env는 핸들러 안에서 읽는다.

const TOSS_BILLING_AUTH_URL = 'https://api.tosspayments.com/v1/billing/authorizations/issue'

type TossBillingResponse = {
  billingKey?: string
  customerKey?: string
  card?: { issuerCode?: string; number?: string; cardType?: string }
  code?: string
  message?: string
}

// '신한 **** 1234' 같은 표시명만 만든다 — 카드번호 원문은 저장하지 않는다.
// 토스가 주는 number는 이미 마스킹된 값(예: '12345678****123*')이라 뒤 4자리만 뽑아 쓴다.
function buildCardLabel(card?: { issuerCode?: string; number?: string }): string | null {
  if (!card) return null
  const digits = (card.number ?? '').replace(/\D/g, '')
  const last4 = digits.length >= 4 ? digits.slice(-4) : ''
  const issuer = card.issuerCode ?? ''
  if (!issuer && !last4) return null
  return [issuer, last4 ? `**** ${last4}` : ''].filter(Boolean).join(' ')
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!
  const tossSecretKey = process.env.TOSS_SECRET_KEY

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { authKey?: string; customerKey?: string } | null
  const authKey = body?.authKey
  const customerKey = body?.customerKey
  if (!authKey || !customerKey) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  // 남의 customerKey로 카드가 붙는 것을 막는 핵심 방어선.
  if (customerKey !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!tossSecretKey) {
    console.error('[billing/authorize] TOSS_SECRET_KEY 미설정')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  // Workers에는 Buffer가 없다 — Basic 인증 인코딩은 btoa로 한다.
  const basicAuth = btoa(`${tossSecretKey}:`)

  let toss: TossBillingResponse
  try {
    const res = await fetch(TOSS_BILLING_AUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authKey, customerKey }),
    })
    toss = await res.json().catch(() => ({})) as TossBillingResponse
    if (!res.ok || !toss.billingKey) {
      // 토스 오류는 { code, message } 형태 — message를 그대로 사용자에게 보여 준다.
      console.error('[billing/authorize] 발급 실패:', user.id, toss.code ?? res.status)
      return NextResponse.json(
        { error: toss.code ?? 'issue_failed', message: toss.message ?? null },
        { status: 400 }
      )
    }
  } catch (e) {
    console.error('[billing/authorize] 토스 호출 실패:', user.id, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'network_error' }, { status: 502 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const now = new Date().toISOString()
  const { error: upsertError } = await serviceClient
    .from('billing_keys')
    .upsert({
      user_id: user.id,
      billing_key: toss.billingKey,
      customer_key: customerKey,
      card_label: buildCardLabel(toss.card),
      updated_at: now,
    }, { onConflict: 'user_id' })

  if (upsertError) {
    console.error('[billing/authorize] billing_keys 저장 실패:', user.id, upsertError.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  console.log('[billing/authorize] 카드 등록 완료:', user.id)
  // 빌링키는 응답에 담지 않는다 — 클라이언트는 표시명만 알면 된다.
  return NextResponse.json({ ok: true, cardLabel: buildCardLabel(toss.card) })
}
