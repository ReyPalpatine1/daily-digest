import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/route-auth'
import { TERMS_VERSION } from '@/lib/consent'
import { sendWelcomeEmail } from '@/lib/mailer'
import { afterAdConsentChanged } from '@/lib/ad-consent'

// 첫 로그인 동의 기록 — 대시보드 동의 팝업(OnboardingModal)에서 호출한다.
// body { ads: boolean }
// - 시각은 클라이언트 값을 받지 않고 서버 now()로 기록한다.
// - 이미 동의한 계정이면 다시 기록하지 않고 성공을 돌려준다(중복 제출 안전).
// - 환영 메일은 welcome_sent_at을 조건부 UPDATE로 선점한 뒤 1회만 보낸다.
//   (기존 회원은 sql/consent.sql에서 welcome_sent_at이 채워져 있어 받지 않는다)
export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY!

  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { ads?: unknown } | null
  if (!body || typeof body.ads !== 'boolean') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const ads = body.ads

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('email, terms_agreed_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) {
    console.error('[consent] 프로필 조회 실패:', user.id, profileError.message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  if (!profile) {
    // 프로필은 대시보드 첫 진입 시 만들어진다 — 그 전에 호출될 일은 없다.
    return NextResponse.json({ error: 'no_profile' }, { status: 409 })
  }

  // === 동의 기록 (최초 1회) ===
  if (!profile.terms_agreed_at) {
    const nowDate = new Date()
    const now = nowDate.toISOString()
    const update: Record<string, unknown> = {
      terms_agreed_at: now,
      age_confirmed_at: now,
      terms_version: TERMS_VERSION,
      ad_consent: ads,
    }
    if (ads) update.ad_consent_at = now
    // 동시 제출 대비 — 아직 비어 있을 때만 기록한다(먼저 들어온 요청 하나만 반영).
    const { data: recorded, error: updateError } = await serviceClient
      .from('profiles')
      .update(update)
      .eq('id', user.id)
      .is('terms_agreed_at', null)
      .select('id')
    if (updateError) {
      console.error('[consent] 동의 기록 실패:', user.id, updateError.message)
      return NextResponse.json({ error: 'server_error' }, { status: 500 })
    }
    // 광고성 정보 수신에 동의했고 이 요청이 기록했으면: 무료 채널 한도 6 즉시 적용 + 동의 처리 결과 통지 메일.
    // (후속 처리 실패는 로그만 — 가입 동의 성공은 유지)
    if (ads && recorded && recorded.length > 0) {
      try {
        await afterAdConsentChanged(serviceClient, user.id, true, nowDate, 'consent')
      } catch (e) {
        console.error('[consent] 광고 동의 후속 처리 실패:', user.id, e instanceof Error ? e.message : e)
      }
    }
  }

  // === 환영 메일 (welcome_sent_at 선점 후 1회) ===
  // 메일 실패는 로그만 남기고 동의 성공은 유지한다.
  try {
    const { data: claimed, error: claimError } = await serviceClient
      .from('profiles')
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('welcome_sent_at', null)
      .select('id')
    if (claimError) {
      console.error('[consent] 환영 메일 선점 실패:', user.id, claimError.message)
    } else if (claimed && claimed.length > 0) {
      const { data: settings } = await serviceClient
        .from('settings')
        .select('email, locale')
        .eq('user_id', user.id)
        .maybeSingle()
      const to = settings?.email || profile.email || user.email
      if (!to) {
        console.error('[consent] 환영 메일 수신 주소 없음:', user.id)
      } else {
        try {
          await sendWelcomeEmail(to, settings?.locale ?? 'ko')
          console.log('[consent] 환영 메일 발송:', user.id)
        } catch (e) {
          console.error('[consent] 환영 메일 발송 실패:', user.id, e instanceof Error ? e.message : e)
          // 보내지 못했으므로 선점을 되돌려 기록을 사실과 맞춘다.
          await serviceClient.from('profiles').update({ welcome_sent_at: null }).eq('id', user.id)
        }
      }
    }
  } catch (e) {
    console.error('[consent] 환영 메일 처리 오류:', user.id, e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ success: true })
}
