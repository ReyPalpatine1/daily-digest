'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase, checkIsPro } from '@/lib/supabase'
import { TOAST_MS } from '@/lib/toast'
import type { Profile } from '@/lib/supabase'
import { useTranslation } from '@/lib/i18n/useTranslation'
import { AppHeader } from '@/components/AppHeader'
import { UpgradeButton } from '@/components/UpgradeButton'
import UserPlanBadge from '@/components/UserPlanBadge'
import HelpPopup from '@/components/HelpPopup'
import RefundModal from '@/components/RefundModal'
import { AlertTriangle, CreditCard, ExternalLink } from 'lucide-react'
import { requestCardRegistration } from '@/lib/toss-billing'

export default function ProfilePage() {
  const router = useRouter()
  const { t, locale } = useTranslation()

  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [toastKey, setToastKey] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])
  const [showDelete, setShowDelete] = useState(false)
  const [deleteAgree, setDeleteAgree] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 도움말 팝업 (설정 메뉴에서 열기). help_seen 저장은 대시보드와 동일 방식.
  const [showHelp, setShowHelp] = useState(false)
  const [settings, setSettings] = useState<{ help_seen: boolean } | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  // 등록된 카드 표시명(예: KB국민카드 **** 7508). 서버가 표시명만 내려준다 — 빌링키는 받지 않는다.
  const [cardLabel, setCardLabel] = useState<string | null>(null)
  // 결제 내역(최근 20건). 서버가 done·failed만 내려준다 — 미완료(pending)·청구 없는 취소분은 제외.
  const [payments, setPayments] = useState<
    { createdAt: string; amount: number; kind: string; status: string; receiptUrl: string | null; refundedAt: string | null }[]
  >([])
  // 자동 갱신 해지 확인 모달 / 중복 클릭 방지
  const [showCancelRenew, setShowCancelRenew] = useState(false)
  const [renewBusy, setRenewBusy] = useState(false)
  // 카드 삭제 확인 모달 / 중복 클릭 방지
  const [showDeleteCard, setShowDeleteCard] = useState(false)
  const [cardBusy, setCardBusy] = useState(false)
  // 환불 진행 중 / 결과 안내. 결과는 성공·실패 한 자리에 쓰고 색으로만 구분한다.
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundNote, setRefundNote] = useState<{ text: string; failed: boolean } | null>(null)
  // 환불 확인 모달. 자격 조회(GET) 결과를 그대로 담아 열고, 확인하면 POST를 쏜다.
  // 서버가 거절하면 창을 닫지 않고 이 값을 자격 없음으로 바꿔 사유를 그 자리에서 보여준다.
  const [refundModal, setRefundModal] = useState<{
    eligible: boolean
    reason: string | null
    amount: number | null
    paidAt: string | null
    isAutoRenew: boolean
  } | null>(null)
  // 환불 후 프로필·결제 내역을 다시 불러오기 위한 트리거.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      if (!data.user) { router.push('/'); return }
      setUser(data.user)

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      if (cancelled) return

      setProfile(profileRow as Profile | null)

      // 도움말 팝업 체크박스 초기값(help_seen)만 로드 (대시보드와 동일 컬럼).
      const { data: settingsRow } = await supabase
        .from('settings')
        .select('help_seen')
        .eq('user_id', data.user.id)
        .maybeSingle()
      if (cancelled) return
      setSettings({ help_seen: (settingsRow as { help_seen?: boolean } | null)?.help_seen ?? false })

      setReady(true)
    })
    return () => { cancelled = true }
  }, [router, reloadKey])

  // 등록된 카드 표시명 조회. 카드가 없으면 null이고, 그 경우 카드 줄 자체를 그리지 않는다.
  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/card')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        setCardLabel(typeof data?.cardLabel === 'string' ? data.cardLabel : null)
      })
      .catch(() => {
        // 조회 실패는 조용히 넘긴다 — 카드 줄이 안 보일 뿐 다른 기능에는 영향이 없다.
      })
    return () => { cancelled = true }
  }, [])

  // 결제 내역 조회. 이력이 0건인 사용자가 다수라 스켈레톤을 두지 않는다 —
  // 결과가 오면 카드가 나타나고, 없으면 애초에 그리지 않는다(위 카드 조회와 같은 방식).
  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/payments')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        setPayments(Array.isArray(data?.payments) ? data.payments : [])
      })
      .catch(() => {
        // 조회 실패는 조용히 넘긴다 — 결제 내역 카드가 안 보일 뿐 다른 기능에는 영향이 없다.
      })
    return () => { cancelled = true }
  }, [reloadKey])

  // HelpPopup 반응형 분기용 (대시보드와 동일 브레이크포인트)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 도움말 닫기: "다시 보지 않기" 체크 상태(true/false)를 help_seen에 양방향 저장 (대시보드와 동일).
  async function closeHelp(dontShowAgain: boolean) {
    setShowHelp(false)
    if (!user) return
    if ((settings?.help_seen ?? false) === dontShowAgain) return // 변경 없으면 저장 생략
    setSettings((prev) => (prev ? { ...prev, help_seen: dontShowAgain } : { help_seen: dontShowAgain }))
    await supabase.from('settings').update({ help_seen: dontShowAgain }).eq('user_id', user.id)
  }

  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US'
  const won = (n: number) => `₩${n.toLocaleString(dateLocale)}`

  // 플랜 판정은 실제 DB(profiles) 하나만 본다 — 대시보드·헤더·요금제와 같은 기준.
  const isPro = checkIsPro(profile)
  const isVip = profile?.plan === 'vip'

  // 기간이 남은 1개월권 사용자에게만 '기간 연장하기'를 연다.
  // getPlanView는 쓰지 않는다 — onetime과 관리자 토글 Pro(plan_status='none')를 구분하지 못한다.
  // active(이미 갱신 중)·trialing(전용 버튼이 따로 있다)·VIP는 대상이 아니다.
  // 잔여 기간과 무관하게 항상 노출한다: 잔여 31일 이상이면 1개월권만 막히고 자동 갱신 전환은
  // 허용되는 정상 경로라(lib/purchase-guard.ts) 버튼을 숨기면 그 경로까지 사라진다.
  // 막힘 사유는 /subscribe가 이미 안내한다.
  const canExtend = !isVip && profile?.plan_status === 'onetime' && isPro

  // 갱신 재시도 대기(dunning) 중인지. 서버의 갱신 대기 조건(lib/plan-sync.ts의 awaitingRenewal,
  // checkIsPro와 동일)에 "실패 이력이 있다"만 더한 것이다.
  // 이 구간에는 만료일이 지나도 뱃지가 PRO로 유지되므로, 이 표시가 없으면 결제가 실패해
  // 재시도 중이라는 사실이 화면 어디에도 드러나지 않는다.
  // renew_fail_count는 위 프로필 조회(select('*'))로 이미 내려온다 — 빌링키는 어느 응답에도 없다.
  const renewRetrying =
    (profile?.renew_fail_count ?? 0) > 0 &&
    profile?.plan_status === 'active' &&
    profile?.cancel_at_period_end === false
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // 대시보드 인사말과 같은 이름 소스
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
  const joinedAt = user?.created_at ? new Date(user.created_at).toLocaleDateString(dateLocale) : null

  // Pro 만료일: VIP(무기한)거나 만료일 없으면 '만료 없음', 그 외엔 날짜
  const expiresLabel = isVip || !profile?.plan_expires_at
    ? t('profile.noExpiry')
    : new Date(profile.plan_expires_at).toLocaleDateString(dateLocale)

  // 토스트 1회 노출. 새 토스트가 뜨면 이전 타이머를 버린다 — 안 그러면 연속 호출 시
  // 이전 타이머가 살아 있어 두 번째 토스트가 제 시간을 못 채우고 일찍 사라진다.
  function showToast(key: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastKey(key)
    toastTimerRef.current = setTimeout(() => {
      setToastKey(null)
      toastTimerRef.current = null
    }, TOAST_MS)
  }

  // 카드 변경 — 구독 시작 때와 같은 토스 카드 등록창을 연다.
  // intent=card라 결과 화면이 카드만 교체하고 결제로 넘어가지 않는다.
  // 등록은 user_id 기준 upsert라 기존 카드가 교체된다(계정당 1장).
  async function changeCard() {
    if (!user) return
    try {
      await requestCardRegistration(user.id, 'card')
    } catch (e) {
      // 창을 닫은 것(USER_CANCEL)은 오류가 아니다 — 그 외에만 원인을 드러낸다.
      const code = (e as { code?: string } | null)?.code
      if (code !== 'USER_CANCEL') {
        console.error('[profile] 카드 변경 실패:', code ?? e)
        showToast('adminUsers.actionFailed')
      }
    }
  }

  // 카드 삭제 — 자동 갱신을 중단한다. 남은 기간은 그대로 유지된다(이미 결제한 몫).
  // 서버가 plan_status를 'onetime'으로 내리므로 화면도 1개월권 사용자와 같은 모습이 된다.
  async function deleteCard() {
    if (cardBusy) return
    setCardBusy(true)
    try {
      const res = await fetch('/api/billing/card', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        showToast('adminUsers.actionFailed')
        return
      }
      setCardLabel(null)
      // 서버가 바꾼 상태를 화면에도 반영한다(자동 갱신 안내·해지 버튼이 사라진다).
      setProfile(prev =>
        prev && prev.plan_status === 'active'
          ? { ...prev, plan_status: 'onetime', cancel_at_period_end: false }
          : prev
      )
      setShowDeleteCard(false)
      showToast('profile.deleteCardDone')
    } catch {
      showToast('adminUsers.actionFailed')
    } finally {
      setCardBusy(false)
    }
  }

  // 자동 갱신 해지 / 되돌리기.
  // 해지해도 즉시 무료로 내려가지 않는다 — 남은 기간은 그대로 쓰고 만료일에 종료된다.
  async function setAutoRenew(cancel: boolean) {
    if (renewBusy) return
    setRenewBusy(true)
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        showToast('adminUsers.actionFailed')
        return
      }
      // 서버가 받아들인 값으로 화면을 맞춘다(재조회 없이 즉시 반영).
      setProfile(prev => (prev ? { ...prev, cancel_at_period_end: cancel } : prev))
      setShowCancelRenew(false)
      showToast(cancel ? 'profile.cancelRenewDone' : 'profile.resumeRenewDone')
    } catch {
      showToast('adminUsers.actionFailed')
    } finally {
      setRenewBusy(false)
    }
  }

  function openDeleteModal() {
    setDeleteAgree(false)
    setShowDelete(true)
  }

  function closeDeleteModal() {
    if (deleting) return
    setShowDelete(false)
  }

  async function handleDelete() {
    if (!deleteAgree || deleting) return
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      if (!res.ok) throw new Error('delete failed')
      await supabase.auth.signOut()
      router.push('/')
    } catch {
      setDeleting(false)
      setShowDelete(false)
      showToast('profile.deleteFailed')
    }
  }

  // === 공용 스타일 ===
  // 플랜명 강조 뱃지 (플랜 카드 핵심 표시) — 앱 공통 색 체계 유지
  const card$: React.CSSProperties = {
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    borderRadius: 12, padding: 18, boxSizing: 'border-box',
  }
  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10 }
  // 환불 — 자격을 먼저 물어보고, 그 결과를 그대로 확인 모달에 넘긴다.
  //
  // 자격 미달 사유는 사람마다 다르고(기간 경과 / 이미 발송됨 / 결제 없음) 각각 다음 행동이
  // 다르므로, 버튼을 감추지 않고 눌렀을 때 사유를 알려준다. 특히 체험·관리자 Pro·VIP처럼
  // 결제 자체가 없는 사용자는 "환불할 결제 내역이 없습니다"를 봐야 납득할 수 있다.
  //
  // ★ 여기 판정은 안내용이다. 실제 자격은 POST가 서버에서 다시 판정한다.
  async function requestRefund() {
    if (refundBusy) return
    setRefundBusy(true)
    setRefundNote(null)
    try {
      const res = await fetch('/api/billing/refund')
      const data = await res.json().catch(() => ({})) as {
        eligible?: boolean; reason?: string
        amount?: number; paidAt?: string; isAutoRenew?: boolean
      }
      if (!res.ok) {
        setRefundNote({ text: t('profile.refundFailed'), failed: true })
        return
      }
      setRefundModal({
        eligible: !!data.eligible,
        reason: data.reason ?? null,
        amount: typeof data.amount === 'number' ? data.amount : null,
        paidAt: data.paidAt ?? null,
        isAutoRenew: !!data.isAutoRenew,
      })
    } catch (e) {
      console.error('[profile] 환불 자격 조회 실패:', e)
      setRefundNote({ text: t('profile.refundFailed'), failed: true })
    } finally {
      setRefundBusy(false)
    }
  }

  // 환불 실행 — 모달의 '환불하기'.
  // 서버가 자격을 다시 판정하므로(그 사이 발송됐거나 기간이 지났을 수 있다) 409는 실패가
  // 아니라 사유가 있는 거절이다 — 창을 닫지 않고 자격 없음으로 바꿔 그 자리에서 알린다.
  async function confirmRefund() {
    if (refundBusy) return
    setRefundBusy(true)
    setRefundNote(null)
    try {
      const res = await fetch('/api/billing/refund', { method: 'POST' })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean; error?: string; reason?: string
      }
      if (res.status === 409) {
        // 이미 환불된 결제(refunded)는 무를 대상이 남아 있지 않다는 뜻이라 '결제 없음'으로 안내한다.
        const reason = data.error === 'refunded' ? 'no_payment' : (data.reason ?? 'no_payment')
        setRefundModal(prev => (prev ? { ...prev, eligible: false, reason } : prev))
        return
      }
      if (!res.ok || !data.ok) {
        setRefundModal(null)
        setRefundNote({ text: t('profile.refundFailed'), failed: true })
        return
      }
      setRefundModal(null)
      setRefundNote({ text: t('profile.refundDone'), failed: false })
      // 플랜·결제 내역이 바뀌었으므로 둘 다 다시 불러온다.
      setReloadKey(key => key + 1)
    } catch (e) {
      console.error('[profile] 환불 요청 실패:', e)
      setRefundModal(null)
      setRefundNote({ text: t('profile.refundFailed'), failed: true })
    } finally {
      setRefundBusy(false)
    }
  }

  const btnSecondary: React.CSSProperties = {
    padding: '7px 12px', borderRadius: 7, border: '0.5px solid var(--border)',
    background: 'var(--bg-card)', color: 'var(--text-secondary)',
    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  }

  const accountRow = (label: string, value: React.ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 0', borderBottom: '0.5px solid var(--border-light)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)', minWidth: 72 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )

  if (!ready) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }} />
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader showBack onHelpClick={() => setShowHelp(true)} />

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 56px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 18px', letterSpacing: -0.4 }}>
          {t('profile.title')}
        </h1>

        {/* ============ 계정 정보 ============ */}
        <div style={{ ...card$, marginBottom: 14 }}>
          <div style={sectionTitle}>{t('profile.accountSection')}</div>
          {accountRow(t('profile.name'), userName)}
          {accountRow(t('profile.email'), user?.email ?? '—')}
          {joinedAt && accountRow(t('profile.joinedAt'), joinedAt)}
        </div>

        {/* ============ 플랜 ============ */}
        <div style={card$}>
          {/* 윗줄: 좌측 (플랜 라벨 + 뱃지) ↔ 우측 (버튼) */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...sectionTitle, marginBottom: 0, marginRight: 8 }}>{t('profile.planSection')}</span>
              <UserPlanBadge plan={plan} size="md" />
            </div>
            {plan === 'FREE' ? <UpgradeButton /> : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {canExtend && (
                  /* 잠금 유도가 아니라 이미 Pro인 사용자의 관리 조작이므로
                     UpgradeButton(강조 CTA)이 아니라 같은 카드의 btnSecondary를 쓴다.
                     해지·카드 변경·카드 삭제와 같은 급으로 보이는 것이 맞다. */
                  <button
                    style={btnSecondary}
                    onClick={() => router.push('/subscribe?mode=pay')}>
                    {t('profile.extendPeriod')}
                  </button>
                )}
                {/* 유료인 사람 모두에게 보인다(체험·관리자 Pro·VIP 포함) —
                    결제가 없는 사람도 눌러서 사유를 확인할 수 있어야 한다. */}
                <button style={btnSecondary} disabled={refundBusy} onClick={requestRefund}>
                  {t('profile.refundBtn')}
                </button>
              </div>
            )}
          </div>
          {refundNote && (
            <div style={{
              marginTop: 10, fontSize: 12,
              color: refundNote.failed ? 'var(--warning)' : 'var(--text-secondary)',
            }}>
              {refundNote.text}
            </div>
          )}
          {/* 아랫줄: 멘트 — 환불 안내가 떠 있는 동안에는 그리지 않는다.
              방금 환불한 사람에게 업그레이드를 권하는 꼴이 되고, 만료일도 환불 안내와
              겹쳐 읽힌다. 새로고침하면 refundNote가 사라져 원래 문구가 돌아온다.
              (refundNote를 타이머로 지우지 않는다 — 실패 문구도 같은 자리를 쓴다.) */}
          {!refundNote && (
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {plan === 'PRO'
                  ? `${t('profile.expiresAt')}: ${expiresLabel}`
                  : t('profile.freeUpsell')}
              </span>
            </div>
          )}

          {/* 자동 갱신 상태 — plan_status='active'일 때만 의미가 있다.
              1개월권(onetime)·체험(trialing)은 애초에 갱신되지 않으므로 이 영역을 그리지 않는다. */}
          {profile?.plan_status === 'active' && (
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border-light)',
              display: 'flex', alignItems: 'center',
              // 해지 상태에는 왼쪽 문장이 없다 — 버튼만 남으므로 오른쪽으로 붙인다.
              justifyContent: profile.cancel_at_period_end ? 'flex-end' : 'space-between',
              gap: 12, flexWrap: 'wrap',
            }}>
              {/* 해지 상태에서는 문장을 두지 않는다 — 만료일이 바로 위에 이미 있어
                  정보를 더하지 못하고, 지시어만 남아 기준점이 흐려진다.
                  줄 자체(구분선·여백)는 유지해야 아래 카드 줄과 붙지 않는다. */}
              {!profile.cancel_at_period_end && (
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {t('profile.autoRenewOn')}
                </span>
              )}
              {/* 안내 문장이 길어 줄바꿈되면 버튼만 왼쪽으로 떨어진다 —
                  남은 폭을 채우고 flex-end로 붙여 같은 카드의 환불·카드 버튼과 축을 맞춘다. */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', flexGrow: 1 }}>
                {profile.cancel_at_period_end ? (
                  <button style={btnSecondary} disabled={renewBusy} onClick={() => setAutoRenew(false)}>
                    {t('profile.resumeAutoRenew')}
                  </button>
                ) : (
                  /* 실수로 해지되지 않도록 확인 단계를 둔다(탈퇴 모달과 같은 패턴). */
                  <button style={btnSecondary} disabled={renewBusy} onClick={() => setShowCancelRenew(true)}>
                    {t('profile.cancelAutoRenew')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 결제 재시도 중 안내 — 만료됐지만 아직 강등되지 않은 구간(최대 3일)에만 뜬다.
              카드 문제를 바로 고칠 수 있게 카드 변경을 같은 줄에 둔다. */}
          {renewRetrying && (
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {t('profile.renewRetrying')}
                </span>
              </div>
              <button style={btnSecondary} onClick={changeCard}>
                {t('profile.changeCard')}
              </button>
            </div>
          )}

          {/* 등록된 카드 — 무슨 카드로 결제되는지 보여준다. 카드가 없으면 표시하지 않는다. */}
          {cardLabel && (
            <>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <CreditCard size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {t('profile.registeredCard')}: {cardLabel}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnSecondary} onClick={changeCard}>
                  {t('profile.changeCard')}
                </button>
                <button style={btnSecondary} disabled={cardBusy} onClick={() => setShowDeleteCard(true)}>
                  {t('profile.deleteCard')}
                </button>
              </div>
            </div>
            {/* 재등록은 계정당 1장 upsert라 기존 카드를 교체한다 — 그 사실을 미리 알린다. */}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              {t('profile.cardReplaceNotice')}
            </div>
            </>
          )}
        </div>

        {/* ============ 결제 내역 ============ */}
        {/* 이력이 0건이면 카드 자체를 그리지 않는다 — 없던 카드가 사라지는 것처럼 보이지 않게. */}
        {payments.length > 0 && (
          <div style={{ ...card$, marginTop: 14 }}>
            <div style={sectionTitle}>{t('profile.paymentsSection')}</div>
            {payments.map((p, i) => (
              <div
                key={`${p.createdAt}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap', padding: '9px 0',
                  borderBottom: i === payments.length - 1 ? 'none' : '0.5px solid var(--border-light)',
                }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {new Date(p.createdAt).toLocaleDateString(dateLocale)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {p.kind === 'auto' ? t('profile.paymentKindAuto') : t('profile.paymentKindOnetime')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* 실패 건은 청구되지 않았다 — 금액을 성공 건처럼 진하게 두지 않는다. */}
                  {/* 환불된 건도 청구가 남아 있지 않다 — 실패 건과 같은 급으로 낮춘다. */}
                  <span style={{
                    fontSize: 13,
                    color: p.status === 'failed' || p.refundedAt
                      ? 'var(--text-muted)' : 'var(--text-primary)',
                  }}>
                    {won(p.amount)}
                  </span>
                  {p.refundedAt && (
                    <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {t('profile.refunded')}
                    </span>
                  )}
                  {p.status === 'failed' && (
                    <span style={{ fontSize: 11.5, color: 'var(--warning)' }}>
                      {t('profile.paymentFailedLabel')}
                    </span>
                  )}
                  {/* receipt_url은 null일 수 있다 — 없으면 링크 자체를 그리지 않는다. */}
                  {p.receiptUrl && (
                    <a
                      href={p.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        fontSize: 11.5, color: 'var(--text-tertiary)', textDecoration: 'none',
                      }}>
                      <ExternalLink size={12} />
                      {t('profile.receipt')}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ============ 위험 영역: 회원 탈퇴 ============ */}
        <div style={{ marginTop: 28, textAlign: 'center' }}>
          <button
            onClick={openDeleteModal}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: '4px 8px', textDecoration: 'underline',
            }}>
            {t('profile.deleteAccount')}
          </button>
        </div>
      </main>

      {/* === 환불 확인 모달 === */}
      {refundModal && (
        <RefundModal
          eligible={refundModal.eligible}
          reason={refundModal.reason}
          amount={refundModal.amount}
          paidAt={refundModal.paidAt}
          isAutoRenew={refundModal.isAutoRenew}
          busy={refundBusy}
          onConfirm={confirmRefund}
          onClose={() => { if (!refundBusy) setRefundModal(null) }}
        />
      )}

      {/* === 카드 삭제 확인 모달 === */}
      {showDeleteCard && (
        <div
          onClick={() => { if (!cardBusy) setShowDeleteCard(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 120,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 400,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 14, padding: 22, boxSizing: 'border-box',
              boxShadow: 'var(--shadow-lg)',
            }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
              {t('profile.deleteCardTitle')}
            </h2>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 18px' }}>
              {t('profile.deleteCardBody', { date: expiresLabel })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteCard(false)}
                disabled={cardBusy}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: '0.5px solid var(--border)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                  cursor: cardBusy ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                {t('common.cancel')}
              </button>
              <button
                onClick={deleteCard}
                disabled={cardBusy}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--text-primary)', color: 'var(--bg-card)',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  cursor: cardBusy ? 'default' : 'pointer',
                  opacity: cardBusy ? 0.5 : 1,
                }}>
                {t('profile.deleteCardConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === 자동 갱신 해지 확인 모달 (탈퇴 모달과 같은 구조·토큰) === */}
      {showCancelRenew && (
        <div
          onClick={() => { if (!renewBusy) setShowCancelRenew(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 120,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 400,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 14, padding: 22, boxSizing: 'border-box',
              boxShadow: 'var(--shadow-lg)',
            }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
              {t('profile.cancelRenewTitle')}
            </h2>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 18px' }}>
              {t('profile.cancelRenewBody', { date: expiresLabel })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCancelRenew(false)}
                disabled={renewBusy}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: '0.5px solid var(--border)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                  cursor: renewBusy ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                {t('common.cancel')}
              </button>
              <button
                onClick={() => setAutoRenew(true)}
                disabled={renewBusy}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--text-primary)', color: 'var(--bg-card)',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  cursor: renewBusy ? 'default' : 'pointer',
                  opacity: renewBusy ? 0.5 : 1,
                }}>
                {t('profile.cancelRenewConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === 탈퇴 확인 모달 === */}
      {showDelete && (
        <div
          onClick={closeDeleteModal}
          style={{
            position: 'fixed', inset: 0, zIndex: 120,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 400,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 14, padding: 22, boxSizing: 'border-box',
              boxShadow: 'var(--shadow-lg)',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertTriangle size={18} style={{ color: 'var(--text-primary)' }} />
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
                {t('profile.deleteConfirmTitle')}
              </h2>
            </div>

            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              {t('profile.deleteConfirmBody')}
            </p>

            {plan === 'PRO' && (
              <p style={{
                fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)',
                margin: '0 0 12px', padding: '10px 12px',
                background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
                borderRadius: 8,
              }}>
                {t('profile.deleteProNotice')}
              </p>
            )}

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer',
              margin: '4px 0 18px',
            }}>
              <input
                type="checkbox"
                checked={deleteAgree}
                onChange={e => setDeleteAgree(e.target.checked)}
                style={{ marginTop: 2, accentColor: 'var(--text-primary)', cursor: 'pointer' }}
              />
              <span>{t('profile.deleteAgree')}</span>
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={closeDeleteModal}
                disabled={deleting}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: '0.5px solid var(--border)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                  cursor: deleting ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={!deleteAgree || deleting}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--text-primary)', color: 'var(--bg-card)',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  cursor: !deleteAgree || deleting ? 'default' : 'pointer',
                  opacity: !deleteAgree || deleting ? 0.5 : 1,
                }}>
                {t('profile.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === 도움말 팝업 (설정 메뉴에서 열기) === */}
      {showHelp && (
        <HelpPopup t={t} isMobile={isMobile} initialDontShow={settings?.help_seen ?? false} isPro={isPro} onClose={closeHelp} />
      )}

      {/* === 토스트 === */}
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
