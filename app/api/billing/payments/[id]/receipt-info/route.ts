import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { TOSS_API, tossAuthHeader } from '@/lib/billing'

// 영수증 확인창용 결제 정보 — 본인 결제만.
//
// 배경: 토스가 2026-09-30부터 매출전표 링크를 열면 본인 인증을 요구한다. 우리는 구매자 이름·이메일을
// 토스에 넘기지 않으므로 사용자가 쓸 수 있는 방법은 카드번호(국민·BC 불가) 또는
// "승인번호 + 금액 + 결제일"뿐인데, 승인번호는 우리 화면 어디에도 없다 → 토스에서 조회해 보여준다.
//
// ★ 승인번호는 DB에 저장하지 않는다(필요할 때 조회해서 보여주기만).
// ★ paymentKey·시크릿은 응답·로그에 넣지 않는다. 로그에는 토스 에러 code만 남긴다.
// ★ 남의 결제·없는 결제·영수증이 없는 결제는 모두 404 — 존재 여부를 구분해 주지 않는다.
// 환불된 결제도 같은 흐름이다(토스가 같은 링크에서 취소 전표를 보여준다).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// approvedAt(ISO, 오프셋 포함)을 KST 날짜 YYYY.MM.DD로 — 토스 인증 화면의 결제일 기준이 KST다.
function kstDate(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms + 9 * 60 * 60 * 1000)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}.${mm}.${dd}`
}

type TossPaymentDetail = {
  totalAmount?: number
  approvedAt?: string
  card?: { approveNo?: string | null } | null
  receipt?: { url?: string } | null
  code?: string
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  // uuid가 아니면 DB에 묻지 않는다(형식 오류가 500으로 새지 않게).
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const { data: row, error } = await serviceClient
    .from('payments')
    .select('user_id, kind, status, payment_key, amount, created_at, receipt_url')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[billing/receipt-info] 조회 실패:', user.id, error.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
  // 본인 결제가 아니거나, 승인되지 않아 토스 결제 식별자가 없는 건은 영수증이 없다.
  if (!row || row.user_id !== user.id || row.status !== 'done' || !row.payment_key) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 결제 종류로 시크릿을 고른다 — auto → 자동결제(빌링) 계약, onetime → 일반결제 계약.
  const authHeader = tossAuthHeader(row.kind === 'auto' ? 'billing' : 'payment')
  if (!authHeader) {
    console.error('[billing/receipt-info] 토스 시크릿 미설정:', row.kind)
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  let toss: TossPaymentDetail
  try {
    const res = await fetch(`${TOSS_API}/payments/${encodeURIComponent(row.payment_key as string)}`, {
      headers: { Authorization: authHeader },
    })
    toss = await res.json().catch(() => ({})) as TossPaymentDetail
    if (!res.ok) {
      console.error('[billing/receipt-info] 토스 조회 실패:', user.id, toss.code ?? res.status)
      return NextResponse.json({ error: 'toss_failed' }, { status: 502 })
    }
  } catch {
    console.error('[billing/receipt-info] 토스 조회 네트워크 오류:', user.id)
    return NextResponse.json({ error: 'toss_failed' }, { status: 502 })
  }

  const receiptUrl = toss.receipt?.url ?? (row.receipt_url as string | null) ?? null
  const paidDate = kstDate(toss.approvedAt ?? (row.created_at as string))
  if (!receiptUrl || !paidDate) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      approveNo: toss.card?.approveNo || null,
      amount: typeof toss.totalAmount === 'number' ? toss.totalAmount : (row.amount as number),
      paidDate,
      receiptUrl,
    },
    // 결제 정보라 어디에도 캐시하지 않는다.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
