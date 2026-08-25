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
import { AlertTriangle, CreditCard } from 'lucide-react'
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
  // 자동 갱신 해지 확인 모달 / 중복 클릭 방지
  const [showCancelRenew, setShowCancelRenew] = useState(false)
  const [renewBusy, setRenewBusy] = useState(false)
  // 카드 삭제 확인 모달 / 중복 클릭 방지
  const [showDeleteCard, setShowDeleteCard] = useState(false)
  const [cardBusy, setCardBusy] = useState(false)

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
  }, [router])

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

  // 플랜 판정은 실제 DB(profiles) 하나만 본다 — 대시보드·헤더·요금제와 같은 기준.
  const isPro = checkIsPro(profile)
  const isVip = profile?.plan === 'vip'

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
            {plan === 'FREE' && <UpgradeButton />}
          </div>
          {/* 아랫줄: 멘트 */}
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {plan === 'PRO'
                ? `${t('profile.expiresAt')}: ${expiresLabel}`
                : t('profile.freeUpsell')}
            </span>
          </div>

          {/* 자동 갱신 상태 — plan_status='active'일 때만 의미가 있다.
              1개월권(onetime)·체험(trialing)은 애초에 갱신되지 않으므로 이 영역을 그리지 않는다. */}
          {profile?.plan_status === 'active' && (
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                {profile.cancel_at_period_end
                  ? t('profile.autoRenewOff', { date: expiresLabel })
                  : t('profile.autoRenewOn')}
              </span>
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
