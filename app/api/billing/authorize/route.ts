import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { buildCardLabel } from '@/lib/toss-cards'

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
    // 원인 구분용 진단 — 런타임에 실제로 보이는 변수 "이름"만 남긴다.
    // (값은 절대 남기지 않는다. 이름만으로 오타·미등록·런타임 미반영을 구분할 수 있다.)
    //   · TOSS 계열이 빈 배열   → 런타임에 등록 안 됨(빌드 변수에만 있거나 다른 워커/환경)
    //   · 비슷한 이름이 보임    → 오타·공백
    //   · SUPABASE 개수가 0     → 런타임 변수 주입 자체가 안 되는 상태
    const envNames = Object.keys(process.env)
    console.error(
      '[billing/authorize] TOSS_SECRET_KEY 미설정 — 런타임 TOSS 계열 이름:',
      envNames.filter(k => /toss/i.test(k)),
      '/ SUPABASE 계열 개수:',
      envNames.filter(k => /supabase/i.test(k)).length,
      '/ 전체 개수:',
      envNames.length
    )
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
      // 토스 오류는 { code, message } 형태 — 원인 파악을 위해 둘 다 그대로 남기고,
      // message는 클라이언트에도 그대로 전달해 화면에 표시한다.
      // ※ 응답 전체를 덤프하지 않는다 — billingKey 같은 민감값이 섞여 들어갈 수 있다.
      console.error('[billing/authorize] 토스 발급 실패:', user.id, {
        status: res.status,
        code: toss.code ?? null,
        message: toss.message ?? null,
      })
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
  const cardLabel = buildCardLabel(toss.card)
  const { error: upsertError } = await serviceClient
    .from('billing_keys')
    .upsert({
      user_id: user.id,
      billing_key: toss.billingKey,
      customer_key: customerKey,
      card_label: cardLabel,
      updated_at: now,
    }, { onConflict: 'user_id' })

  if (upsertError) {
    console.error('[billing/authorize] billing_keys 저장 실패:', user.id, upsertError.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  console.log('[billing/authorize] 카드 등록 완료:', user.id)
  // 빌링키는 응답에 담지 않는다 — 클라이언트는 표시명만 알면 된다.
  return NextResponse.json({ ok: true, cardLabel })
}
