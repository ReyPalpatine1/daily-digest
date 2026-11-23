import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/route-auth'
import { setAdConsent } from '@/lib/ad-consent'

// 설정 탭의 광고성 정보 수신 동의 토글. body { consent: boolean } (로그인 필수).
// 확인창 없이 즉시 처리한다(철회를 어렵게 하면 안 된다 — 정보통신망법 제50조).
// 켜기: ad_consent=true·ad_consent_at=now·ad_reconfirm_notified_at=null → 채널 재활성화 → 동의 통지 메일.
// 끄기: ad_consent=false·ad_withdrawn_at=now → 채널 한도 재적용 → 철회 통지 메일.
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { consent?: unknown } | null
  if (!body || typeof body.consent !== 'boolean') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const result = await setAdConsent(user.id, body.consent, 'ad-consent')
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'no_profile' ? 409 : 500 })
  }
  return NextResponse.json({
    success: true,
    changed: result.changed,
    adConsent: result.adConsent,
    processedAt: result.processedAt,
    deactivatedChannels: result.deactivatedChannels,
  })
}
