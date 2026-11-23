// 광고성 정보 수신 동의·철회 처리 (서버 전용 — SUPABASE_SERVICE_KEY 사용).
// 설정 토글(/api/ad-consent)·수신거부 링크(/api/unsubscribe)·가입 동의(/api/consent)가 모두 이 파일을 쓴다.
// env는 함수 안에서 읽는다(Cloudflare 호환).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkIsPro, type Profile } from './supabase'
import { enforceChannelLimit } from './plan-sync'
import { sendAdConsentNoticeEmail, sendAdReconfirmEmail } from './mailer'
import { adsUnsubscribeLinks } from './email-ads'

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export type AdConsentResult =
  | { ok: false; reason: 'no_profile' | 'server_error' }
  | {
      ok: true
      // false면 이미 같은 상태였다(아무것도 바꾸지 않았고 통지 메일도 보내지 않았다).
      changed: boolean
      adConsent: boolean
      processedAt: string
      // 이번 처리로 비활성화된 채널 수(무료 회원 철회 시). 화면 갱신 판단용.
      deactivatedChannels: number
      // 통지·완료 화면 표기용 회원 언어
      locale: string
    }

// 회원 수신 주소·언어 — 발송 설정(settings)을 먼저, 없으면 계정 이메일.
async function recipientOf(client: SupabaseClient, userId: string, fallbackEmail: string | null) {
  const { data: settings } = await client
    .from('settings')
    .select('email, locale')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    to: (settings?.email as string | null) || fallbackEmail,
    locale: (settings?.locale as string | null) ?? 'ko',
  }
}

// 동의 상태가 실제로 바뀐 뒤의 후속 처리: 무료 회원 채널 한도 재적용(철회=초과분 비활성,
// 재동의=같은 순서로 재활성화) + 처리 결과 통지 메일. 메일 실패는 로그만 남긴다.
export async function afterAdConsentChanged(
  client: SupabaseClient,
  userId: string,
  consent: boolean,
  processedAt: Date,
  logTag: string,
): Promise<{ deactivatedChannels: number; locale: string }> {
  const { data: profile } = await client
    .from('profiles')
    .select('email, plan, plan_expires_at, plan_status, cancel_at_period_end')
    .eq('id', userId)
    .maybeSingle()

  let deactivatedChannels = 0
  // Pro·VIP는 한도가 없다(동의 여부 무관) — 무료 회원만 한도를 다시 맞춘다.
  if (profile && !checkIsPro(profile as Profile)) {
    try {
      deactivatedChannels = await enforceChannelLimit(userId)
    } catch (e) {
      console.error(`[${logTag}] 채널 한도 재적용 실패:`, userId, e instanceof Error ? e.message : e)
    }
  }

  const { to, locale } = await recipientOf(client, userId, (profile?.email as string | null) ?? null)
  if (!to) {
    console.error(`[${logTag}] 통지 메일 수신 주소 없음:`, userId)
  } else {
    try {
      await sendAdConsentNoticeEmail(to, consent ? 'agree' : 'withdraw', processedAt, locale, userId)
    } catch (e) {
      console.error(`[${logTag}] 처리 결과 통지 메일 실패:`, userId, e instanceof Error ? e.message : e)
    }
  }
  return { deactivatedChannels, locale }
}

// 동의(true)·철회(false). 이미 같은 상태면 아무것도 바꾸지 않는다(통지 메일 중복 금지).
// 조건부 UPDATE(현재 값이 반대일 때만)로 동시 요청에도 한 번만 처리된다.
export async function setAdConsent(userId: string, consent: boolean, logTag: string): Promise<AdConsentResult> {
  const client = serviceClient()
  const { data: profile, error } = await client
    .from('profiles')
    .select('ad_consent')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error(`[${logTag}] 프로필 조회 실패:`, userId, error.message)
    return { ok: false, reason: 'server_error' }
  }
  if (!profile) return { ok: false, reason: 'no_profile' }

  const now = new Date()
  const nowIso = now.toISOString()
  if (profile.ad_consent === consent) {
    const { locale } = await recipientOf(client, userId, null)
    return { ok: true, changed: false, adConsent: consent, processedAt: nowIso, deactivatedChannels: 0, locale }
  }

  const update = consent
    ? { ad_consent: true, ad_consent_at: nowIso, ad_reconfirm_notified_at: null }
    : { ad_consent: false, ad_withdrawn_at: nowIso }
  const { data: updated, error: updateError } = await client
    .from('profiles')
    .update(update)
    .eq('id', userId)
    .eq('ad_consent', !consent)
    .select('id')
  if (updateError) {
    console.error(`[${logTag}] 동의 상태 변경 실패:`, userId, updateError.message)
    return { ok: false, reason: 'server_error' }
  }
  if (!updated || updated.length === 0) {
    // 다른 요청이 먼저 같은 변경을 마쳤다 — 후속 처리는 그쪽이 한다.
    const { locale } = await recipientOf(client, userId, null)
    return { ok: true, changed: false, adConsent: consent, processedAt: nowIso, deactivatedChannels: 0, locale }
  }

  console.log(`[${logTag}] 광고 수신 ${consent ? '동의' : '철회'}:`, userId)
  const { deactivatedChannels, locale } = await afterAdConsentChanged(client, userId, consent, now, logTag)
  return { ok: true, changed: true, adConsent: consent, processedAt: nowIso, deactivatedChannels, locale }
}

const TWO_YEARS_MS = 2 * 365.2425 * 24 * 60 * 60 * 1000
const RECONFIRM_BATCH = 50

// 2년 재확인 통지 (매 /api/cron 실행마다 호출 — 대상이 없으면 조회 1회로 끝난다).
// 대상: ad_consent=true AND now() >= COALESCE(ad_reconfirm_notified_at, ad_consent_at) + 2년.
// ad_reconfirm_notified_at을 조건부 UPDATE로 선점한 뒤 발송한다(중복 발송 금지).
export async function runAdReconfirmNotices(): Promise<void> {
  const client = serviceClient()
  const cutoff = new Date(Date.now() - TWO_YEARS_MS).toISOString()

  // 두 갈래로 조회: 재확인 통지를 받은 적 있는 계정은 그 시각 기준, 없는 계정은 동의 시각 기준.
  const [notifiedBefore, neverNotified] = await Promise.all([
    client.from('profiles')
      .select('id, email, ad_consent_at, ad_reconfirm_notified_at')
      .eq('ad_consent', true)
      .not('ad_reconfirm_notified_at', 'is', null)
      .lte('ad_reconfirm_notified_at', cutoff)
      .limit(RECONFIRM_BATCH),
    client.from('profiles')
      .select('id, email, ad_consent_at, ad_reconfirm_notified_at')
      .eq('ad_consent', true)
      .is('ad_reconfirm_notified_at', null)
      .not('ad_consent_at', 'is', null)
      .lte('ad_consent_at', cutoff)
      .limit(RECONFIRM_BATCH),
  ])
  if (notifiedBefore.error || neverNotified.error) {
    console.error('[ad-reconfirm] 대상 조회 실패:', notifiedBefore.error?.message ?? neverNotified.error?.message)
    return
  }
  const targets = [...(notifiedBefore.data ?? []), ...(neverNotified.data ?? [])]
  if (targets.length === 0) return

  for (const row of targets) {
    const links = adsUnsubscribeLinks(row.id)
    if (!links) {
      console.error('[ad-reconfirm] UNSUBSCRIBE_SECRET 미설정 — 재확인 통지 보류')
      return
    }
    // 선점: 조회 당시 값 그대로일 때만 갱신(동시 실행 시 한 번만 발송).
    let claim = client.from('profiles')
      .update({ ad_reconfirm_notified_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('ad_consent', true)
    claim = row.ad_reconfirm_notified_at
      ? claim.eq('ad_reconfirm_notified_at', row.ad_reconfirm_notified_at)
      : claim.is('ad_reconfirm_notified_at', null)
    const { data: claimed, error: claimError } = await claim.select('id')
    if (claimError) {
      console.error('[ad-reconfirm] 선점 실패:', row.id, claimError.message)
      continue
    }
    if (!claimed || claimed.length === 0) continue

    const { to, locale } = await recipientOf(client, row.id, (row.email as string | null) ?? null)
    if (!to) {
      console.error('[ad-reconfirm] 수신 주소 없음:', row.id)
      continue
    }
    try {
      await sendAdReconfirmEmail(to, new Date(row.ad_consent_at as string), links.unsubscribeUrl, locale, row.id)
      console.log('[ad-reconfirm] 재확인 통지 발송:', row.id)
    } catch (e) {
      // 선점은 유지한다 — 되돌리면 매 cron마다 재시도로 폭주할 수 있다. 실패는 email_logs에 남는다.
      console.error('[ad-reconfirm] 발송 실패:', row.id, e instanceof Error ? e.message : e)
    }
  }
}
