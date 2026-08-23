'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { translations } from '@/lib/i18n/translations'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { checkPurchaseBlock } from '@/lib/purchase-guard'
import { TOAST_MS } from '@/lib/toast'
import { AppHeader } from '@/components/AppHeader'
import { Ban } from 'lucide-react'
import { loadTossPayments } from '@tosspayments/tosspayments-sdk'
import { requestCardRegistration } from '@/lib/toss-billing'

const PRICE_MONTHLY = 4900

type PayType = 'auto' | 'onetime'

function SubscribeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale } = useTranslation()

  const mode: 'trial' | 'pay' = searchParams.get('mode') === 'trial' ? 'trial' : 'pay'

  const [ready, setReady] = useState(false)
  // 토스 customerKey로 그대로 쓰는 값 — 추측 불가·고유해야 하므로 Supabase UUID를 쓴다(이메일 금지).
  const [userId, setUserId] = useState<string | null>(null)
  // 구매 제한 판정용(현재 플랜·만료일). 서버도 같은 규칙으로 다시 검사한다.
  const [profile, setProfile] = useState<Profile | null>(null)
  const [payType, setPayType] = useState<PayType>('auto')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreeAutoPay, setAgreeAutoPay] = useState(false)
  const [toastKey, setToastKey] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])
  const [submitting, setSubmitting] = useState(false)
  // trial 모드로 잘못 진입한 재가입자(체험 이력 있음) 대비 — 확인 전엔 화면 미확정.
  const [trialChecked, setTrialChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      if (cancelled) return
      setProfile(profileRow as Profile | null)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [router])

  useEffect(() => {
    if (mode !== 'trial') { setTrialChecked(true); return }
    let cancelled = false
    fetch('/api/subscription/trial')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data?.eligible === false) router.replace('/subscribe?mode=pay')
        setTrialChecked(true)
      })
      .catch(() => {
        // 조회 실패 시 trial 화면 유지(POST 서버 검증이 최종 방어선)
        if (!cancelled) setTrialChecked(true)
      })
    return () => { cancelled = true }
  }, [mode, router])

  const subscribe = (((translations as Record<string, any>)[locale]?.subscribe) ?? translations.en.subscribe) as typeof translations.ko.subscribe
  const pricing = (((translations as Record<string, any>)[locale]?.pricing) ?? translations.en.pricing) as typeof translations.ko.pricing

  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const won = (n: number) => `₩${n.toLocaleString(dateLocale)}`
  const billingDate = new Date()
  billingDate.setDate(billingDate.getDate() + 7)
  const billingDateLabel = billingDate.toLocaleDateString(dateLocale)

  // 새 토스트가 뜨면 이전 타이머를 버린다 — 안 그러면 연속 호출 시 이전 타이머가
  // 살아 있어 두 번째 토스트가 제 시간을 못 채우고 일찍 사라진다.
  function showToast(key: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastKey(key)
    toastTimerRef.current = setTimeout(() => {
      setToastKey(null)
      toastTimerRef.current = null
    }, TOAST_MS)
  }

  // 구매 제한 — 화면에서 막고, 서버(/api/billing/charge·order·confirm)도 같은 함수로 다시 막는다.
  // 체험 화면에는 결제가 없으므로 적용하지 않는다.
  const blockAuto = mode === 'pay' ? checkPurchaseBlock(profile, 'auto') : null
  const blockOnetime = mode === 'pay' ? checkPurchaseBlock(profile, 'onetime') : null
  const blockedNow = payType === 'auto' ? blockAuto : blockOnetime
  const expiresLabel = profile?.plan_expires_at
    ? new Date(profile.plan_expires_at).toLocaleDateString(dateLocale)
    : ''

  // 이용 기간이 남아 있으면 자동 갱신 등록 시 즉시 결제하지 않는다(서버도 같은 판정).
  // 남은 기간을 그대로 쓰고 만료일부터 매월 결제된다 — 기간을 잃지 않게 하는 규칙이다.
  const keepsCurrentPeriod =
    profile?.plan === 'pro' && !!profile.plan_expires_at && new Date(profile.plan_expires_at) > new Date()

  // 기본 선택(자동 갱신)이 막혀 있고 1개월권은 열려 있으면 열린 쪽으로 옮겨 준다.
  useEffect(() => {
    if (blockAuto && !blockOnetime) setPayType('onetime')
  }, [blockAuto, blockOnetime])

  function blockReason(block: ReturnType<typeof checkPurchaseBlock>): string | null {
    if (block === 'active_subscription') return subscribe.blockedActive
    if (block === 'enough_remaining') return t('subscribe.blockedEnough', { date: expiresLabel })
    return null
  }

  const canSubmit = mode === 'trial'
    ? agreeTerms
    : !blockedNow && agreeTerms && (payType !== 'auto' || agreeAutoPay)

  async function startTrial() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/subscription/trial', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        router.push('/dashboard')
        return
      }
      if (data.error === 'trial_already_used') {
        // 체험 불가 안내 후 결제 모드로 전환 — 사용자가 바로 결제 흐름을 이어갈 수 있게.
        showToast('subscribe.trialUsedNotice')
        router.replace('/subscribe?mode=pay')
        return
      }
      showToast('adminUsers.actionFailed')
    } catch {
      showToast('adminUsers.actionFailed')
    } finally {
      setSubmitting(false)
    }
  }

  // 토스 결제창에서 돌아온 예외를 공통 처리한다.
  // 사용자가 창을 닫은 것(USER_CANCEL)은 오류가 아니므로 조용히 화면만 되돌리고,
  // 그 외(클라이언트 키 문제 등 설정 오류)는 침묵하면 버튼이 무반응으로 보여 원인을
  // 찾을 수 없으므로 토스트로 드러낸다.
  function handleTossError(where: string, e: unknown) {
    const code = (e as { code?: string } | null)?.code
    if (code !== 'USER_CANCEL') {
      console.error(`[subscribe] ${where} 실패:`, code ?? e)
      showToast('adminUsers.actionFailed')
    }
    setSubmitting(false)
  }

  // 자동 갱신: 카드 등록(빌링키 발급 인증) → 결과 화면이 이어서 결제까지 처리한다.
  // 카드 정보는 토스 결제창이 직접 받으므로 우리 화면·서버는 카드번호를 만지지 않는다(PCI).
  async function registerCard() {
    if (!userId) { router.push('/'); return }
    setSubmitting(true)
    try {
      await requestCardRegistration(userId, 'subscribe')
      // 성공 시 토스가 successUrl로 이동시키므로 여기로는 돌아오지 않는다.
    } catch (e) {
      handleTossError('카드 등록', e)
    }
  }

  // 1개월권: 빌링키 없이 일반 결제창으로 그때 한 번만 결제한다.
  // orderId·금액은 서버가 먼저 만들어 둔다 — 클라이언트가 만든 주문번호를 쓰면
  // 남의 주문에 붙거나 금액이 다른 주문을 재사용당할 수 있다.
  async function payOnce() {
    if (!userId) { router.push('/'); return }
    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
    if (!clientKey) { showToast('adminUsers.actionFailed'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/billing/order', { method: 'POST' })
      const order = await res.json().catch(() => ({}))
      if (!res.ok || !order?.orderId) {
        showToast('adminUsers.actionFailed')
        setSubmitting(false)
        return
      }
      const toss = await loadTossPayments(clientKey)
      const origin = window.location.origin
      await toss.payment({ customerKey: userId }).requestPayment({
        method: 'CARD',
        // 카드/간편결제 통합결제창. 계좌이체·가상계좌·휴대폰결제는 method가 'CARD'라 애초에 뜨지 않는다.
        // (결제위젯은 위젯 전용 클라이언트 키가 필요해 이 연동 키로는 쓸 수 없다.)
        card: { flowMode: 'DEFAULT' },
        amount: { value: order.amount, currency: 'KRW' },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: origin + '/subscribe/payment-result',
        failUrl: origin + '/subscribe/payment-result?fail=1',
      })
    } catch (e) {
      handleTossError('1개월권 결제', e)
    }
  }

  function handleSubmit() {
    if (blockedNow) return
    if (!canSubmit) { showToast('subscribe.needAgree'); return }
    if (mode === 'trial') { startTrial(); return }
    if (payType === 'auto') { registerCard(); return }
    payOnce()
  }

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 14,
    padding: 20,
    boxSizing: 'border-box',
  }
  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12 }
  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 9, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-card)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
  const disabledBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 9, border: '0.5px solid var(--border)',
    background: 'var(--bg-subtle)', color: 'var(--text-muted)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }

  // 살 수 없는 방식은 고를 수 없게 하고 이유를 그 자리에서 밝힌다
  // (눌러도 아무 일도 없는 버튼을 남기지 않는다).
  function payOption(
    value: PayType,
    title: string,
    desc: string,
    block: ReturnType<typeof checkPurchaseBlock>,
    note?: string | null
  ) {
    const selected = payType === value && !block
    // 막혀 있으면 이유가 우선이다 — 못 고르는 방식에 "고르면 이렇게 된다"를 덧붙일 이유가 없다.
    const line = blockReason(block) ?? note
    return (
      <button
        onClick={() => { if (!block) setPayType(value) }}
        disabled={!!block}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
          textAlign: 'left', padding: '12px 14px', borderRadius: 10,
          border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)',
          background: block ? 'var(--bg-subtle)' : 'var(--bg-card)',
          cursor: block ? 'default' : 'pointer', fontFamily: 'inherit',
          marginBottom: 8, opacity: block ? 0.75 : 1,
        }}>
        <input
          type="radio"
          checked={selected}
          disabled={!!block}
          onChange={() => { if (!block) setPayType(value) }}
          style={{ width: 15, height: 15, marginTop: 2, cursor: block ? 'default' : 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: block ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{desc}</div>
          {line && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
              {line}
            </div>
          )}
        </div>
      </button>
    )
  }

  if (!ready || !trialChecked) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack />

      <main style={{ maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 20px', letterSpacing: -0.4 }}>
          {subscribe.title}
        </h1>

        {/* 가격 (실결제 모드에서만 — 체험은 아래 통합 카드가 대신함) */}
        {mode === 'pay' && (
          <div style={{ ...card, marginBottom: 16, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>{won(PRICE_MONTHLY)}</span>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{pricing.perMonth}</span>
            </div>
          </div>
        )}

        {mode === 'trial' ? (
          /* 체험 통합 카드 (무료체험 · 종료 후 가격을 한 장으로) */
          <div style={{ ...card, marginBottom: 16, padding: 20 }}>
            {/* 무료 체험 강조(가장 큰 위계) */}
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, marginBottom: 10 }}>
              {subscribe.firstWeekFree}
            </div>
            {/* 종료일 */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {t('subscribe.trialEnds', { date: billingDateLabel })}
            </div>
            {/* 구분선 */}
            <div style={{ height: 1, background: 'var(--border-light)', margin: '14px 0' }} />
            {/* 종료 후 가격 + 자동결제 없음 (두 줄) */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Ban size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                <div>{t('subscribe.afterTrialPrice', { price: `${won(PRICE_MONTHLY)}${pricing.perMonth}` })}</div>
                <div>{subscribe.noAutoCharge}</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 결제 방식 */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={sectionTitle}>{subscribe.paymentMethod}</div>
              {payOption(
                'auto',
                subscribe.proMonthly,
                `${won(PRICE_MONTHLY)} · ${pricing.perMonth}`,
                blockAuto,
                // 기간이 남아 있으면 지금 결제되지 않는다 — 이 방식을 고를 때 가장 중요한 정보다.
                keepsCurrentPeriod ? t('subscribe.autoRenewFromDate', { date: expiresLabel }) : null
              )}
              {payOption('onetime', subscribe.onetime, `${won(PRICE_MONTHLY)} · ${subscribe.onetimeNotice}`, blockOnetime)}
              {/* 어느 방식을 골라도 해당되는 안내라 박스 맨 아래에 한 줄로 둔다. */}
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
                {subscribe.cardNotice}
              </div>
            </div>
          </>
        )}

        {/* 약관 동의 */}
        <div style={{ ...card, marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={e => setAgreeTerms(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            {subscribe.agreeTerms}
          </label>
          {mode === 'pay' && payType === 'auto' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', marginTop: 10 }}>
              <input
                type="checkbox"
                checked={agreeAutoPay}
                onChange={e => setAgreeAutoPay(e.target.checked)}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
              />
              {subscribe.agreeAutoPay}
            </label>
          )}
        </div>

        {mode === 'pay' && (
          <div style={{
            marginBottom: 12, padding: '10px 12px',
            background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
            borderRadius: 8,
            fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)',
          }}>
            {subscribe.refundNotice}
          </div>
        )}

        <button style={canSubmit ? primaryBtn : disabledBtn} onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? '···'
            : mode === 'trial'
              ? subscribe.startTrialCta
              : payType === 'auto' ? subscribe.registerCardCta : subscribe.payCta}
        </button>

        {mode === 'trial' && (
          <div style={{
            marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 12, color: 'var(--text-muted)',
          }}>
            <Ban size={13} />
            {subscribe.noCardNote}
          </div>
        )}
      </main>

      {/* 토스트 */}
      {toastKey && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
          padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)',
          // 읽기 전용이라 클릭을 받을 이유가 없다 — 노출 중 아래쪽 버튼을 막지 않게 통과시킨다.
          pointerEvents: 'none',
        }}>
          {t(toastKey)}
        </div>
      )}
    </div>
  )
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />}>
      <SubscribeContent />
    </Suspense>
  )
}
