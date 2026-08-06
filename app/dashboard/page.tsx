'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Category, Channel, Settings, Digest, Profile } from '@/lib/supabase'
import { normalizeChannelUrl } from '@/lib/channel-url'
import { recordSignupRef } from '@/lib/signup-ref'
import { captureShareIntent, readShareIntent, clearShareIntent } from '@/lib/share-intent'
import { useTranslation } from '@/lib/i18n/useTranslation'
import UserPlanBadge from '@/components/UserPlanBadge'
import { UpgradeButton } from '@/components/UpgradeButton'
import { LanguageSubmenu } from '@/components/LanguageSubmenu'
import HelpPopup from '@/components/HelpPopup'
import TrialPopup from '@/components/TrialPopup'
import { AppHeader } from '@/components/AppHeader'
import AdCard from '@/components/AdCard'
import { CHANNELS, orderedChannels, type ChannelId } from '@/lib/channels'
import { Mail, Send, MessageCircle, MessageSquare, Lock, Check, Copy, Share2, X } from 'lucide-react'
import ShareSheet from '@/components/ShareSheet'
import { splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'
import { usePending } from '@/lib/use-pending'
import { SkeletonList } from '@/components/Skeleton'
import ScrollTopButton from '@/components/ScrollTopButton'

// 진행 중 버튼 표기 — "지금 바로 실행" 버튼의 비활성 처리와 동일 토큰.
const pendingBtnStyle: React.CSSProperties = {
  cursor: 'not-allowed',
  background: 'var(--bg-subtle)',
  color: 'var(--text-muted)',
}
// 아이콘/텍스트 링크형 동작(✓ ✕ 등)은 라벨 교체가 불가 → 진행 중엔 흐리게 + 클릭 차단.
const pendingIconStyle: React.CSSProperties = {
  opacity: 0.45,
  pointerEvents: 'none',
}

// 열람기록 상단 미리보기 안내 카드를 닫았는지 (기기별 1회 노출용, DB 컬럼 대신 로컬 저장)
const PREVIEW_GUIDE_KEY = 'ddv_preview_guide_done'

// 열람 기록 한 페이지 크기. digests 행에는 요약 본문이 통째로 실려 있어 한 번에 많이 받으면
// 모바일 첫 로딩이 느려진다 → 나눠 받고 "더 보기"로 이어붙인다.
// 검색·필터가 서버 쿼리로 옮겨져 목록이 "불러온 범위"에 갇히지 않으므로 한 페이지를 더 작게 잡는다.
const HISTORY_PAGE_SIZE = 50

// 개요(채널 탭 통계 + 필터 드롭다운 후보)용 경량 조회 상한.
// 본문 없이 5개 컬럼만 읽고, 검색·필터와 무관하게 보관 기간 전체를 훑는다.
// digests 목록이 필터로 좁혀져도 통계·드롭다운이 따라 줄어들지 않게 하려는 용도.
const HISTORY_OVERVIEW_LIMIT = 2000

// 열람 기록 검색어 디바운스 — 타자마다 DB를 때리지 않도록.
const HISTORY_SEARCH_DEBOUNCE_MS = 400

function randomColor(usedColors: string[] = []) {
  const colors = ['#4da6ff', '#47ffb2', '#ff4757', '#c47fff', '#ffaa47', '#ff6b9d', '#00d2d3', '#ffd32a', '#a29bfe', '#fd79a8', '#55efc4', '#fdcb6e']
  const available = colors.filter(c => !usedColors.includes(c))
  const pool = available.length > 0 ? available : colors
  return pool[Math.floor(Math.random() * pool.length)]
}

// KST 기준 YYYY-MM-DD (offset 일수만큼 이전 날짜)
function kstDateStr(offsetDays = 0): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600_000 - offsetDays * 86_400_000)
  return kst.toISOString().slice(0, 10)
}

type TFn = (key: string, params?: Record<string, string | number>) => string

function timeAgo(iso: string | null | undefined, t: TFn): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return t('time.justNow')
  const min = Math.floor(ms / 60_000)
  if (min < 1) return t('time.justNow')
  if (min < 60) return t('time.minutesAgo', { n: min })
  const hour = Math.floor(min / 60)
  if (hour < 24) return t('time.hoursAgo', { n: hour })
  const day = Math.floor(hour / 24)
  if (day < 7) return t('time.daysAgo', { n: day })
  const week = Math.floor(day / 7)
  if (week < 4) return t('time.weeksAgo', { n: week })
  const month = Math.floor(day / 30)
  return t('time.monthsAgo', { n: month })
}

// 발송 채널 → lucide 아이콘 매핑. lucide엔 카카오/라인/왓츠앱 브랜드 아이콘이
// 없어 메시지 계열 대체 아이콘 사용.
const channelIcons: Record<ChannelId, typeof Mail> = {
  email: Mail,
  telegram: Send,
  kakao: MessageCircle,
  whatsapp: MessageCircle,
  line: MessageSquare,
}

// 열람기록 표시용 확장 타입. digests 테이블엔 tldr 컬럼이 없어(비어 있음),
// 로드 시 video_summaries.tldr(locale 매칭)을 병합해 역피라미드 최상단에 노출한다.
type HistoryDigest = Digest & { tldr?: string | null }

// 개요용 경량 행 — 채널 탭 통계와 필터 드롭다운 후보만 만들면 되므로 본문(summary 등)은 읽지 않는다.
type HistoryOverviewRow = {
  created_at: string
  channel_alias: string
  category_name: string | null
  is_breaking: boolean | null
  is_read: boolean | null
}

// 기록 항목의 실패·대기·라이브 사유 라벨 키 (카드 상단).
// 매칭 없으면 null → 라벨 생략 (과거 데이터 호환: fail_reason 없는 행).
function summaryStatusKeys(d: Digest): { labelKey: string; noteKey?: string } | null {
  switch (d.fail_reason) {
    case 'no_source': return { labelKey: 'history.failNoSourceLabel', noteKey: 'history.failNoSourceNote' }
    case 'temporary': return { labelKey: 'history.failTemporaryLabel', noteKey: 'history.failTemporaryNote' }
    case 'pending': return { labelKey: 'history.failPendingLabel', noteKey: 'history.failPendingNote' }
    case 'live': return { labelKey: 'history.failLiveLabel', noteKey: 'history.failLiveNote' }
    case 'pro_only': return { labelKey: 'history.proOnlyLabel', noteKey: 'history.proOnlyNote' }
  }
  return null
}

// 요약 기반(자막/설명) 표기 키 — 이메일과 동일하게 카드 맨 아래에 둔다(성공 케이스 전용).
// 실패·대기 항목은 상단 사유 라벨이 설명하므로 표시하지 않는다.
function summaryBasisKeys(d: Digest): { labelKey: string; noteKey?: string } | null {
  if (d.fail_reason) return null
  const basis = d.summary_basis ?? ''
  if (basis.includes('자막')) return { labelKey: 'history.basisTranscriptLabel' }
  if (basis.includes('설명')) return { labelKey: 'history.basisDescriptionLabel', noteKey: 'history.basisDescriptionNote' }
  return null
}

export default function Dashboard() {
  const router = useRouter()
  const { t, locale, changeLocale } = useTranslation()
  const dateLocale = ({ ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' } as Record<string, string>)[locale] ?? 'en-US'
  const [user, setUser] = useState<any>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [digests, setDigests] = useState<HistoryDigest[]>([])
  // 검색·필터와 무관한 보관 기간 전체의 경량 스냅샷.
  // digests는 이제 서버에서 필터링돼 오므로, 필터를 걸어도 변하면 안 되는 값
  // (채널 탭 통계, 속보 뱃지, 필터 드롭다운 후보)은 전부 이 배열에서 계산한다.
  const [historyOverview, setHistoryOverview] = useState<HistoryOverviewRow[]>([])
  // 보관 기간이 지나 숨겨진 기록 수(무료 전용 안내). 목록과 별개로 개수만 세어 담는다.
  const [hiddenByRetentionCount, setHiddenByRetentionCount] = useState(0)
  // 열람 기록에 다음 페이지가 남아 있는지("더 보기" 노출 조건)
  const [hasMoreDigests, setHasMoreDigests] = useState(false)
  const [activeTab, setActiveTab] = useState<'channels' | 'schedule' | 'history'>('channels')
  // PRO 전용 채널 클릭 시 잠깐 뜨는 안내 문구(결제창 이동 없음)
  const [channelNotice, setChannelNotice] = useState<string | null>(null)
  // 열람 기록 "맨 위로" 버튼: 일정량 스크롤 시 노출
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [filterCat, setFilterCat] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'breaking'>('all')
  const [historySearch, setHistorySearch] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [historyDate, setHistoryDate] = useState('')
  const [historyChannel, setHistoryChannel] = useState('')
  const [historyCategory, setHistoryCategory] = useState('')
  // 실제 쿼리에 쓰이는 검색어(디바운스 통과분). 목록·더 보기가 같은 값을 봐야
  // 페이지 경계에서 조건이 어긋나지 않으므로, 조회는 항상 이 값만 참조한다.
  const [historySearchApplied, setHistorySearchApplied] = useState('')
  // 첫 진입 데이터 로딩(인증→프로필→loadData) 구간.
  const [initialLoading, setInitialLoading] = useState(true)
  // 미리보기 실행 결과 토스트 (하단 중앙 알약, 2.5초)
  const [previewToast, setPreviewToast] = useState<string | null>(null)
  // 열람기록 상단 미리보기 안내 카드의 "닫음" 상태 (localStorage, 기기별).
  // 초기값 true = 서버/첫 렌더에서 잠깐 보였다 사라지는 깜빡임 방지.
  const [previewGuideDone, setPreviewGuideDone] = useState(true)
  const [newKeyword, setNewKeyword] = useState('')
  const [expandedDigest, setExpandedDigest] = useState<string | null>(null)
  // 열람기록 요약 카드 "공유" 시트 대상 (null이면 닫힘)
  const [shareTarget, setShareTarget] = useState<null | { videoId: string; title: string; tldr: string; summary: string; timeline: { time: string; content: string }[]; keyPoints: string[] }>(null)

  const [newChannel, setNewChannel] = useState({ url: '', alias: '', emoji: '📺', category_id: '' })
  const [newCategory, setNewCategory] = useState({ name: '', color: '#4da6ff' })

  const [editingCat, setEditingCat] = useState<string | null>(null)
  const [editingCatName, setEditingCatName] = useState('')
  const [movingChannel, setMovingChannel] = useState<string | null>(null)
  const [editingChannel, setEditingChannel] = useState<string | null>(null)
  const [editChannelData, setEditChannelData] = useState({ alias: '', emoji: '', url: '' })

  const [pendingSendTime, setPendingSendTime] = useState('07:00')
  const [pendingEmail, setPendingEmail] = useState('')
  const [sendTimeStatus, setSendTimeStatus] = useState<'idle' | 'saved'>('idle')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saved'>('idle')
  const [telegramLinking, setTelegramLinking] = useState(false) // 코드 발급 fetch 중(버튼 비활성)
  const [linkPending, setLinkPending] = useState(false) // ② 연결 대기 중
  const [telegramRemaining, setTelegramRemaining] = useState(0) // 카운트다운(초)
  const [telegramLinkCode, setTelegramLinkCode] = useState('') // 발급된 연결 코드
  const [codeCopied, setCodeCopied] = useState(false) // 복사 완료 표시
  const telegramPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const telegramCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const telegramExpiryRef = useRef<number>(0)

  // 서버 호출 버튼 진행 표시 — 동작별 인스턴스(하나의 pending이 무관한 버튼을 잠그지 않도록 분리).
  // 200ms 안에 끝나는 응답에서는 pending이 켜지지 않아 깜빡임이 없다(lib/use-pending.ts).
  const chAdd = usePending()
  const chUpdate = usePending()
  const chDelete = usePending()
  const chMove = usePending()
  const catAdd = usePending()
  const catRename = usePending()
  const catDelete = usePending()
  const kwAdd = usePending()
  const kwRemove = usePending()
  const sendTimeSave = usePending()
  const emailSave = usePending()
  const tgConnect = usePending()
  const tgDisconnect = usePending()
  const planSwitch = usePending()
  const previewRun = usePending()
  const loadMore = usePending()
  // 필터 변경 재조회 — 200ms 지연 노출 규칙을 그대로 써서 빠른 응답에는 스켈레톤이 깜빡이지 않는다.
  const historyReload = usePending()

  // --- Phase 2: 새 디자인용 UI 상태 ---
  // 처음 사용자 도움말 팝업: 진입 시 help_seen===false 자동 노출 / 설정에서 재열기
  const [showHelp, setShowHelp] = useState(false)
  // 헤더(로고·탭·테마·설정 드롭다운)는 공용 AppHeader가 담당. 대시보드는 사이드바만 자체 관리.
  // 실제 구독 상태는 profile.plan(free/pro/vip)에서 판정
  const [profile, setProfile] = useState<Profile | null>(null)

  // Pro 체험 종료 안내 팝업(전날 ending / 당일 ended). 메일 발송 플래그(notified)가 있고
  // 팝업 확인(seen) 전이면 노출. Profile 타입에 없는 플래그 4종은 프로필 원본 행에서 따로 보관.
  const [trialPopup, setTrialPopup] = useState<'ending' | 'ended' | null>(null)
  const [trialFlags, setTrialFlags] = useState<{
    trial_ending_notified_at: string | null
    trial_ended_notified_at: string | null
    trial_ending_popup_seen_at: string | null
    trial_ended_popup_seen_at: string | null
  } | null>(null)

  // isPro는 항상 실제 profile.plan 기준(관리자도 동일). 관리자 Free/Pro 토글이
  // 실제 DB plan을 바꾸므로 별도 미리보기 플래그(adminPlanMode)를 두지 않는다.
  // checkIsPro의 2번째 인자(isAdmin)를 false로 고정해 "관리자=무조건 Pro" 단축을 끈다.
  const isPro = checkIsPro(profile, false)
  // VIP/Pro 모두 사용자에겐 "PRO"로 표시 (구분 없음)
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // --- Phase 3: 채널 탭 검색 상태 ---
  const [channelSearch, setChannelSearch] = useState('')
  const [showChannelSearch, setShowChannelSearch] = useState(false)
  // Free 한도 (Pro는 한도 없음 → 렌더에서 '무제한' 처리)
  const channelLimit = 5
  const retentionDays = isPro ? 30 : 7
  // 보관 기간 판정은 서버 쿼리(historyCutoffIso)로 옮겼다 — 화면에서 다시 자르지 않는다.
  // 이중으로 걸면 서버가 준 페이지가 화면에서 또 사라져 "더 보기"가 헛돌았다.
  // plan 미로드 시점(profile null·비관리자) 구분은 공유 딥링크 대기에 계속 쓰인다.
  const planLoaded = isAdmin || profile !== null
  // 활성/비활성 채널 수 (plan 강등 시 비활성 채널 존재 가능)
  const activeChannelCount = channels.filter(c => c.is_active !== false).length
  const inactiveChannelCount = channels.length - activeChannelCount

  // 이메일 카드의 공유 링크(?share=<videoId>) 보관 — 아래 로그인 확인·리다이렉트보다 먼저 저장한다
  // (미로그인이면 '/'로 빠지면서 쿼리가 사라지므로). 저장 후 URL에서 share만 제거해 새로고침 시 재실행을 막는다.
  useEffect(() => {
    if (!captureShareIntent(window.location.search)) return
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('share')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {}
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      // 리다이렉트 경로는 화면이 곧 사라지므로 스켈레톤을 유지한 채 빠진다.
      if (!data.user) { window.location.href = '/'; return }
      try {
        setUser(data.user)
        const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
        const isAdminUser = adminEmails.includes(data.user.email?.toLowerCase() ?? '')
        setIsAdmin(isAdminUser)

        // 프로필 없으면 자동 생성 (신규 가입자는 plan='free')
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single()

        // 아래 loadData는 setProfile 직후에 호출되므로 state의 isPro가 아직 옛값이다.
        // 방금 조회(또는 생성)한 프로필로 플랜을 직접 계산해 넘겨야 Pro가 30일치를 받는다.
        let loadedProfile: Profile | null = null

        if (!profileRow) {
          const email = data.user.email ?? ''
          const newProfile = {
            id: data.user.id,
            name: data.user.user_metadata?.full_name ?? email,
            email,
            plan: 'free' as const,
          }
          await supabase.from('profiles').insert(newProfile)
          loadedProfile = {
            ...newProfile,
            plan_expires_at: null,
            vip_granted_by: null,
            vip_granted_at: null,
            plan_status: 'none',
            trial_used: false,
            // DB 기본값과 동일하게 null (insert에는 넣지 않는다)
            preview_used_at: null,
            first_digest_at: null,
          }
          setProfile(loadedProfile)
          // 기본 설정 자동 생성
          await supabase.from('settings').insert({
            user_id: data.user.id,
            send_time: '07:00',
            email: data.user.email,
            breaking_keywords: ['속보'],
            breaking_alert: true,
            active: true,
          })
          // 기본 카테고리 1개 자동 생성
          await supabase.from('categories').insert([
            { user_id: data.user.id, name: '기본 카테고리', color: '#4da6ff' },
          ])
        } else {
          loadedProfile = profileRow as Profile
          setProfile(loadedProfile)
          const row = profileRow as Record<string, any>
          setTrialFlags({
            trial_ending_notified_at: row.trial_ending_notified_at ?? null,
            trial_ended_notified_at: row.trial_ended_notified_at ?? null,
            trial_ending_popup_seen_at: row.trial_ending_popup_seen_at ?? null,
            trial_ended_popup_seen_at: row.trial_ended_popup_seen_at ?? null,
          })
        }

        // 공유 링크 유입 기록 (신규 가입 1회 - 통계용).
        // 프로필이 보장된 직후에 호출하며, 실패는 조용히 무시하고 진입을 막지 않는다.
        void recordSignupRef(
          data.user.id,
          profileRow ? (profileRow as Record<string, any>) : null,
        )

        // 마지막 접속 기록 (실패해도 무시 - 통계용)
        supabase
          .from('profiles')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', data.user.id)
          .then(() => {}, () => {})

        // isPro state는 아직 갱신 전이므로 방금 확정한 프로필 기준으로 계산해 넘긴다.
        // (isAdmin=false 고정은 상단 isPro 계산과 같은 규칙 — "관리자=무조건 Pro" 단축을 끈다)
        await loadData(data.user.id, checkIsPro(loadedProfile, false))
      } finally {
        // 실패해도 스켈레톤이 남지 않도록 반드시 해제
        setInitialLoading(false)
      }
    }).catch(() => setInitialLoading(false))
  }, [])

  // 공유 링크(?share=) 소비 — 열람 기록이 채워지고 플랜이 확정된 뒤 1회만.
  // (planLoaded 전에는 보관 기간 판정이 틀릴 수 있으므로 그때까지 보관값을 유지한 채 기다린다)
  // 대상 요약을 찾으면 열람기록 탭으로 옮기고 공유 시트를 연다.
  // 성공·실패와 무관하게 보관값을 지운다(중복 실행 방지). 시트가 이미 열려 있으면 덮어쓰지 않는다.
  const shareIntentDoneRef = useRef(false)
  useEffect(() => {
    if (shareIntentDoneRef.current || initialLoading || !planLoaded || shareTarget) return
    const intent = readShareIntent()
    shareIntentDoneRef.current = true
    if (!intent) return
    clearShareIntent()
    // fail_reason이 있는 항목은 공유할 요약이 없다 → 카드의 공유 버튼과 동일하게 대상에서 제외.
    // 보관 기간 판정은 하지 않는다 — 서버가 보관 범위 안의 기록만 주므로 digests에 있으면 볼 수 있는 기록이다.
    const target = digests.find(d => d.video_id === intent.videoId && !d.fail_reason)
    if (!target) {
      showPreviewToast('그 요약을 열람 기록에서 찾지 못했어요. 보관 기간이 지났을 수 있습니다.')
      return
    }
    setActiveTab('history')
    setShareTarget({
      videoId: target.video_id,
      title: target.video_title,
      tldr: target.tldr ?? '',
      summary: target.summary ?? '',
      timeline: target.timeline ?? [],
      keyPoints: target.key_points ?? [],
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading, planLoaded, digests, shareTarget])

  // 미리보기 안내 카드 닫음 여부 로드 (localStorage 접근은 클라이언트에서만)
  useEffect(() => {
    try {
      setPreviewGuideDone(localStorage.getItem(PREVIEW_GUIDE_KEY) === '1')
    } catch {
      setPreviewGuideDone(true) // 접근 차단 환경(사생활 보호 모드 등)에선 노출하지 않음
    }
  }, [])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    if (settings) {
      setPendingSendTime(settings.send_time ?? '07:00')
      setPendingEmail(settings.email ?? '')
    }
  }, [settings])

  // 첫 진입 시 도움말 팝업 자동 노출 (settings 로드 후, 마운트당 1회).
  // help_seen===false 일 때만. 닫아도(체크 안 했으면) 같은 세션엔 다시 안 띄움.
  const helpAutoShownRef = useRef(false)
  useEffect(() => {
    if (settings && !helpAutoShownRef.current && settings.help_seen === false) {
      helpAutoShownRef.current = true
      setShowHelp(true)
    }
  }, [settings])

  // 체험 종료 안내 팝업 자동 노출 (프로필·설정 로드 후 1회).
  // 도움말 팝업이 뜨는 조건(help_seen===false)이면 이번 진입엔 띄우지 않음(동시 노출 방지).
  const trialPopupCheckedRef = useRef(false)
  useEffect(() => {
    if (trialPopupCheckedRef.current || !profile || !trialFlags || !settings) return
    trialPopupCheckedRef.current = true
    if (settings.help_seen === false) return
    if (trialFlags.trial_ended_notified_at != null && trialFlags.trial_ended_popup_seen_at == null) {
      setTrialPopup('ended')
    } else if (
      trialFlags.trial_ending_notified_at != null && trialFlags.trial_ending_popup_seen_at == null &&
      (profile.plan_status === 'trialing' || profile.plan_status === 'onetime')
    ) {
      setTrialPopup('ending')
    }
  }, [profile, trialFlags, settings])

  // 텔레그램 연결 완료 감지 → 폴링 중단
  useEffect(() => {
    if (settings?.telegram_chat_id && linkPending) {
      clearTelegramTimers()
      setLinkPending(false)
      setTelegramRemaining(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.telegram_chat_id])

  // 언마운트 시 폴링 타이머 정리
  useEffect(() => {
    return () => {
      if (telegramPollTimerRef.current) clearTimeout(telegramPollTimerRef.current)
      if (telegramCountdownRef.current) clearInterval(telegramCountdownRef.current)
    }
  }, [])

  // OS 선호도 변경 자동 반영 (사용자가 명시 토글하지 않은 경우에만).
  // 테마 토글 UI/상태는 AppHeader가 담당하므로 여기선 document.dataset만 직접 갱신한다.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onSystemChange(e: MediaQueryListEvent) {
      try { if (localStorage.getItem('theme')) return } catch { return }
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [])

  const sendTimeOptions = (() => {
    const arr: string[] = []
    for (let h = 0; h < 24; h++) {
      arr.push(`${String(h).padStart(2, '0')}:00`)
      arr.push(`${String(h).padStart(2, '0')}:30`)
    }
    return arr
  })()

  const currentSendTime = settings?.send_time ?? '07:00'
  const currentEmail = settings?.email ?? ''
  const sendTimeChanged = pendingSendTime !== currentSendTime
  const emailChanged = pendingEmail !== currentEmail

  async function saveSendTime() {
    if (!sendTimeChanged) return
    await saveSettings({ send_time: pendingSendTime })
    setSendTimeStatus('saved')
    setTimeout(() => setSendTimeStatus('idle'), 1500)
  }

  async function saveEmail() {
    if (!emailChanged) return
    await saveSettings({ email: pendingEmail })
    setEmailStatus('saved')
    setTimeout(() => setEmailStatus('idle'), 1500)
  }

  // 텔레그램 연결 타이머(카운트다운·폴링) 일괄 정리
  function clearTelegramTimers() {
    if (telegramPollTimerRef.current) { clearTimeout(telegramPollTimerRef.current); telegramPollTimerRef.current = null }
    if (telegramCountdownRef.current) { clearInterval(telegramCountdownRef.current); telegramCountdownRef.current = null }
  }

  // ②→① 취소/만료: 타이머·폴링 정리 후 연결 전 상태로 복귀
  function cancelTelegramLink() {
    clearTelegramTimers()
    setLinkPending(false)
    setTelegramRemaining(0)
    setTelegramLinkCode('')
    setCodeCopied(false)
  }

  async function connectTelegram() {
    if (!user || telegramLinking) return
    setTelegramLinking(true)
    try {
      const res = await fetch('/api/telegram/link-code', { method: 'POST' })
      if (!res.ok) return
      const { code } = await res.json() as { code: string }
      setTelegramLinkCode(code)
      // ②로 전환: 10분(600초) 카운트다운 + 5초 간격 연결 폴링
      clearTelegramTimers()
      setLinkPending(true)
      telegramExpiryRef.current = Date.now() + 600_000
      setTelegramRemaining(600)
      telegramCountdownRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((telegramExpiryRef.current - Date.now()) / 1000))
        setTelegramRemaining(remaining)
        if (remaining <= 0) {
          // 만료 → ①로 복귀(타이머·폴링 정리)
          clearTelegramTimers()
          setLinkPending(false)
        }
      }, 1000)
      const uid = user.id
      const poll = () => {
        loadData(uid)
        telegramPollTimerRef.current = setTimeout(poll, 5000)
      }
      telegramPollTimerRef.current = setTimeout(poll, 5000)
    } catch {
      // 무시: ① 상태 유지
    } finally {
      setTelegramLinking(false)
    }
  }

  async function disconnectTelegram() {
    if (!user) return
    cancelTelegramLink()
    await saveSettings({ telegram_chat_id: null, delivery_method: 'email' })
  }

  // 열람 기록 보관 기간의 시작점(ISO). 날짜를 직접 넣지 않고 항상 지금 기준으로 계산한다.
  // isProHint: state의 isPro가 아직 옛값인 시점(프로필 setState 직후)에 쓰는 우회로.
  function historyCutoffIso(isProHint?: boolean): string {
    const days = (isProHint ?? isPro) ? 30 : 7
    return new Date(Date.now() - days * 86_400_000).toISOString()
  }

  // 열람 기록 조회 조건 한 벌 — 첫 페이지와 "더 보기"가 반드시 같은 조건을 써야
  // 페이지 경계에서 중복·누락이 없다. 두 곳이 조건을 각자 갖지 않도록 여기서만 만든다.
  // (range만 호출부에서 다르게 준다)
  function buildDigestQuery(userId: string, cutoffIso: string) {
    let q = supabase.from('digests').select('*').eq('user_id', userId)
      .gte('created_at', cutoffIso)
    if (historyFilter === 'breaking') q = q.eq('is_breaking', true)
    if (historyChannel) q = q.eq('channel_alias', historyChannel)
    if (historyCategory) q = q.eq('category_name', historyCategory)
    if (historyDate) {
      // 기존 클라이언트 판정은 created_at.startsWith(historyDate) = UTC 기준이었다.
      // 동작을 바꾸지 않도록 같은 기준(UTC 하루)으로 범위를 만든다.
      const dayStart = `${historyDate}T00:00:00.000Z`
      const next = new Date(dayStart)
      next.setUTCDate(next.getUTCDate() + 1)
      q = q.gte('created_at', dayStart).lt('created_at', next.toISOString())
    }
    if (historySearchApplied) {
      // PostgREST의 or()는 쉼표로 조건을, 마침표로 컬럼·연산자·값을 나누고 괄호로 묶는다.
      // 값을 큰따옴표로 감싸면 그 안의 , ( ) . : 는 구분자로 해석되지 않는다.
      // 큰따옴표는 이스케이프하고, 역슬래시는 제거한다(LIKE 이스케이프 문자라 끝에 오면 쿼리가 깨진다).
      const kw = historySearchApplied.replace(/\\/g, '').replace(/"/g, '\\"')
      if (kw) q = q.or(`video_title.ilike."%${kw}%",summary.ilike."%${kw}%"`)
    }
    // 2차 정렬 키(id)는 동점(같은 created_at) 순서를 고정한다 — 없으면 페이지 경계에서 행이 중복·누락된다.
    return q.order('created_at', { ascending: false }).order('id', { ascending: false })
  }

  async function loadData(userId: string, isProHint?: boolean) {
    const proNow = isProHint ?? isPro
    const cutoffIso = historyCutoffIso(isProHint)
    // 목록을 1페이지로 되돌리므로 진행 중인 "더 보기" 응답은 무효화한다.
    historyEpochRef.current++
    const [{ data: cats }, { data: chs }, { data: sets }, { data: digs, error: digsError }, { data: overview }, hiddenRes] =
      await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId),
        supabase.from('channels').select('*').eq('user_id', userId),
        supabase.from('settings').select('*').eq('user_id', userId).single(),
        buildDigestQuery(userId, cutoffIso).range(0, HISTORY_PAGE_SIZE - 1),
        // 검색·필터를 걸지 않은 경량 스냅샷 — 채널 탭 통계·속보 뱃지·필터 후보용.
        supabase.from('digests').select('created_at, channel_alias, category_name, is_breaking, is_read')
          .eq('user_id', userId).gte('created_at', cutoffIso)
          .order('created_at', { ascending: false }).limit(HISTORY_OVERVIEW_LIMIT),
        // 보관 기간이 지나 숨겨진 기록 수 — 무료 전용 Pro 유도 안내에만 쓴다(본문 없이 개수만).
        // Pro는 안내 자체를 띄우지 않으므로 조회하지 않는다.
        proNow
          ? Promise.resolve(null)
          : supabase.from('digests').select('id', { count: 'exact', head: true })
              .eq('user_id', userId)
              .lt('created_at', cutoffIso)
              .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
      ])
    // PostgREST 오류는 message만으로는 원인을 알 수 없다(details/hint에 들어 있음) → 객체 전체를 남긴다.
    if (digsError) console.error('[history] 조회 실패:', digsError)
    const sortedCats = (cats ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    const sortedChs = (chs ?? []).sort((a, b) => a.alias.localeCompare(b.alias, 'ko'))
    setCategories(sortedCats)
    setChannels(sortedChs)
    setSettings(sets)

    // tldr은 발송 시점에 digests.tldr로 함께 기록되므로 그대로 사용한다.
    // (과거엔 video_summaries에서 병합했으나 그 테이블은 RLS SELECT 정책이 없어 브라우저 조회가 항상 빈 결과였다)
    const rows = (digs ?? []) as HistoryDigest[]
    setDigests(rows)
    // 페이지가 꽉 찼으면 다음 페이지가 있을 수 있다는 뜻.
    setHasMoreDigests(rows.length === HISTORY_PAGE_SIZE)
    setHistoryOverview((overview ?? []) as HistoryOverviewRow[])
    // 개수 조회 실패는 조용히 넘어간다(안내만 안 뜬다).
    setHiddenByRetentionCount(hiddenRes?.count ?? 0)
  }

  // 목록을 통째로 갈아끼울 때마다 증가시킨다. "더 보기" 응답이 돌아왔을 때 값이 달라져 있으면
  // 그 사이 다른 조건의 목록으로 바뀐 것이므로 이어붙이지 않는다(조건이 섞인 목록 방지).
  const historyEpochRef = useRef(0)

  // 열람 기록 첫 페이지 다시 조회 — 필터가 바뀌었을 때 목록을 통째로 갈아끼운다.
  // 조건은 loadData와 같은 buildDigestQuery를 쓰므로 어긋날 수 없다.
  async function reloadHistoryFirstPage(userId: string) {
    historyEpochRef.current++
    await historyReload.run(async () => {
      const { data, error } = await buildDigestQuery(userId, historyCutoffIso())
        .range(0, HISTORY_PAGE_SIZE - 1)
      if (error || !data) {
        // 조용히 넘어가면 화면상 "아무 반응 없음"이 되어 원인을 알 수 없다.
        // PostgREST 오류는 details/hint에 원인이 있으므로 객체 전체를 남긴다.
        if (error) console.error('[history] 조회 실패:', error)
        // 목록은 그대로 두고(기존 동작) 사용자에겐 한 줄만 알린다.
        showPreviewToast(t('history.loadError'))
        return
      }
      const rows = data as HistoryDigest[]
      setDigests(rows)
      setHasMoreDigests(rows.length === HISTORY_PAGE_SIZE)
    })
  }

  // 열람 기록 다음 페이지 — 기존 목록을 교체하지 않고 뒤에 이어붙인다.
  // 정렬·범위 조건은 loadData와 완전히 동일해야 페이지 경계에서 중복·누락이 없다.
  // 실패는 콘솔에만 남기고 화면엔 알리지 않는다 — 사용자가 직접 누른 동작이라 버튼 복구로 즉시 알 수 있다
  // (버튼은 usePending이 원상 복구).
  async function loadMoreDigests() {
    if (!user) return
    await loadMore.run(async () => {
      const epoch = historyEpochRef.current
      const from = digests.length
      const { data, error } = await buildDigestQuery(user.id, historyCutoffIso())
        .range(from, from + HISTORY_PAGE_SIZE - 1)
      if (error || !data) {
        if (error) console.error('[history] 조회 실패:', error)
        return
      }
      // 응답을 기다리는 사이 목록이 갈아끼워졌으면 버린다.
      if (historyEpochRef.current !== epoch) return
      const rows = data as HistoryDigest[]
      // 오프셋 방식이라 앞 페이지 이후 새 기록이 들어오면 같은 행이 다시 올 수 있다 → id로 한 번 걸러낸다.
      setDigests(prev => {
        const seen = new Set(prev.map(d => d.id))
        return [...prev, ...rows.filter(d => !seen.has(d.id))]
      })
      setHasMoreDigests(rows.length === HISTORY_PAGE_SIZE)
    })
  }

  // 검색어 디바운스 — 타자마다 조회하지 않도록 400ms 뒤에만 적용값으로 승격한다.
  useEffect(() => {
    const timer = setTimeout(
      () => setHistorySearchApplied(historySearch.trim()),
      HISTORY_SEARCH_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [historySearch])

  // 필터가 바뀌면 1페이지부터 다시 조회. 검색어는 위에서 디바운스된 값만 본다.
  // 첫 마운트에서는 건너뛴다 — loadData가 이미 1페이지를 채우므로 중복 조회가 된다.
  const historyFilterReadyRef = useRef(false)
  useEffect(() => {
    if (!historyFilterReadyRef.current) {
      historyFilterReadyRef.current = true
      return
    }
    if (!user) return
    void reloadHistoryFirstPage(user.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySearchApplied, historyFilter, historyDate, historyChannel, historyCategory])

  // 프로필만 재로드 (관리자 토글로 plan 변경 후 isPro 갱신용)
  async function reloadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) setProfile(data as Profile)
  }

  // Free 플랜 채널 한도 도달 시 업그레이드 유도 (확인 시 /pricing 이동)
  function promptChannelLimit() {
    if (confirm(t('alerts.channelLimitReached'))) {
      router.push('/pricing')
    }
  }

  async function addChannel() {
    if (!newChannel.url.trim()) {
      alert(t('alerts.needChannelUrl'))
      return
    }
    if (!newChannel.alias.trim()) {
      alert(t('alerts.needChannelAlias'))
      return
    }
    // 중복 채널 방지 (정규화 URL 기준)
    const normalizedNew = normalizeChannelUrl(newChannel.url)
    if (channels.some(ch => normalizeChannelUrl(ch.url) === normalizedNew)) {
      alert(t('alerts.channelDuplicate'))
      return
    }
    // Free 사용자 채널 수 제한 (활성 채널 기준, 프론트 1차 체크)
    if (!isPro && activeChannelCount >= channelLimit) {
      promptChannelLimit()
      return
    }
    // 서버 라우트로 추가 (서버에서도 plan/한도 재검증 - 보안)
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: newChannel.url.trim(),
        alias: newChannel.alias.trim(),
        emoji: newChannel.emoji,
        category_id: newChannel.category_id || null,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      if (res.status === 403 && err.code === 'CHANNEL_LIMIT') {
        promptChannelLimit()
      } else if (res.status === 409 && err.code === 'CHANNEL_DUPLICATE') {
        alert(t('alerts.channelDuplicate'))
      } else {
        alert(t('alerts.channelAddFailed'))
      }
      return
    }
    setNewChannel({ url: '', alias: '', emoji: '📺', category_id: '' })
    setShowAddChannel(false)
    loadData(user.id)
  }

  async function deleteChannel(id: string) {
    const channel = channels.find(c => c.id === id)
    if (!confirm(t('alerts.confirmDeleteChannel', { name: channel?.alias ?? '' }))) return
    await supabase.from('channels').delete().eq('id', id)
    loadData(user.id)
  }

  async function addCategory() {
    if (!newCategory.name.trim()) {
      alert(t('alerts.needCategoryName'))
      return
    }
    await supabase.from('categories').insert({
      user_id: user.id,
      name: newCategory.name.trim(),
      color: randomColor(categories.map(c => c.color)),
    })
    setNewCategory({ name: '', color: '' })
    setShowAddCategory(false)
    loadData(user.id)
  }

  async function deleteCategory(id: string) {
    const category = categories.find(c => c.id === id)
    if (!confirm(t('alerts.confirmDeleteCategory', { name: category?.name ?? '' }))) return
    await supabase.from('channels').update({ category_id: null }).eq('category_id', id)
    await supabase.from('categories').delete().eq('id', id)
    loadData(user.id)
  }

  async function updateCategoryName(id: string, name: string) {
    if (!name.trim()) return
    await supabase.from('categories').update({ name: name.trim() }).eq('id', id)
    setEditingCat(null)
    setEditingCatName('')
    loadData(user.id)
  }

  async function moveChannel(channelId: string, categoryId: string) {
    await supabase.from('channels').update({ category_id: categoryId || null }).eq('id', channelId)
    setMovingChannel(null)
    loadData(user.id)
  }

  async function updateChannel(id: string) {
    if (!editChannelData.alias.trim()) {
      alert(t('alerts.needChannelAlias'))
      return
    }
    if (!editChannelData.url.trim()) {
      alert(t('alerts.needChannelUrl'))
      return
    }
    await supabase.from('channels').update({
      alias: editChannelData.alias.trim(),
      emoji: editChannelData.emoji || '📺',
      url: editChannelData.url.trim(),
      channel_id: null, // URL 바뀌면 channel_id 재추출
    }).eq('id', id)
    setEditingChannel(null)
    setEditChannelData({ alias: '', emoji: '', url: '' })
    loadData(user.id)
  }

  // 도움말 팝업 닫기. "다시 보지 않기" 체크 상태(true/false)를 help_seen에 양방향 저장.
  // 체크=다시 안 봄(자동 노출 끔), 해제=다음 진입 시 다시 자동 노출. 다른 컬럼 불변.
  async function closeHelp(dontShowAgain: boolean) {
    setShowHelp(false)
    if (!user) return
    if ((settings?.help_seen ?? false) === dontShowAgain) return // 변경 없으면 저장 생략
    setSettings((prev) => (prev ? { ...prev, help_seen: dontShowAgain } : prev))
    await supabase.from('settings').update({ help_seen: dontShowAgain }).eq('user_id', user.id)
  }

  // 체험 팝업 닫기/구독 이동. 확인 시각을 seen 컬럼에 기록해 재노출 방지(기록 실패해도 UI 진행).
  async function closeTrialPopup(goSubscribe: boolean) {
    const col = trialPopup === 'ended' ? 'trial_ended_popup_seen_at' : 'trial_ending_popup_seen_at'
    setTrialPopup(null)
    try { await supabase.from('profiles').update({ [col]: new Date().toISOString() }).eq('id', user.id) } catch {}
    if (goSubscribe) router.push('/subscribe?mode=pay')
  }

  async function saveSettings(updated: Partial<Settings>) {
    if (!user) return
    const merged = { ...settings, ...updated, user_id: user.id }
    await supabase.from('settings').upsert(merged)
    loadData(user.id)
  }

  async function addKeyword() {
    if (!newKeyword.trim() || !settings) return
    const keywords = [...(settings.breaking_keywords ?? ['속보']), newKeyword.trim()]
    await saveSettings({ breaking_keywords: keywords })
    setNewKeyword('')
  }

  async function removeKeyword(kw: string) {
    if (!settings) return
    const keywords = settings.breaking_keywords.filter(k => k !== kw)
    await saveSettings({ breaking_keywords: keywords })
  }

  // 미리보기 안내 카드 닫기 (X · 확인 버튼 공용)
  function dismissPreviewGuide() {
    try {
      localStorage.setItem(PREVIEW_GUIDE_KEY, '1')
    } catch {
      // 저장 실패해도 이번 세션에선 닫힌다
    }
    setPreviewGuideDone(true)
  }

  // 토스트 1회 노출 (하단 중앙 알약, 2.5초 — pricing/profile과 동일 패턴)
  function showPreviewToast(message: string) {
    setPreviewToast(message)
    setTimeout(() => setPreviewToast(null), 2500)
  }

  // 미리보기 실행 — 구독 채널 최신 3개를 지금 요약해 열람 기록에 채운다(메일 발송 없음).
  // 계정당 1회이며 서버(profiles.preview_used_at)에서 선점·검증한다.
  async function runPreview() {
    if (!user) return
    // 서버 maxDuration=60s + 네트워크/콜드스타트 여유 = 90s
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90_000)

    try {
      const res = await fetch('/api/preview', { method: 'POST', signal: controller.signal })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.success) {
        await loadData(user.id)
        await reloadProfile(user.id)
        setActiveTab('history')
        showPreviewToast(t('preview.toastDone'))
        return
      }
      if (res.ok && data.empty) {
        // 서버가 선점을 해제했으므로 버튼은 그대로 두고 안내만 한다.
        showPreviewToast(t('preview.toastEmpty'))
        return
      }
      showPreviewToast(t('preview.toastError'))
      await reloadProfile(user.id)
    } catch (err: any) {
      console.error('[runPreview] 실패:', err)
      showPreviewToast(err?.name === 'AbortError' ? t('preview.toastTimeout') : t('preview.toastError'))
      await reloadProfile(user.id)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async function markAsRead(digestId: string) {
    const digest = digests.find(d => d.id === digestId)
    if (!digest || !digest.is_breaking || digest.is_read) return

    setDigests(prev => prev.map(d =>
      d.id === digestId ? { ...d, is_read: true } : d
    ))

    await supabase
      .from('digests')
      .update({ is_read: true })
      .eq('id', digestId)
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  // 관리자 Free/Pro 토글 — 본인 계정의 실제 DB plan을 변경(일반 강등/승격과 동일 효과).
  // 강등(free) 시 set-plan이 채널 정리 + delivery_method→email 복구까지 수행한다.
  async function switchPlanMode(mode: 'free' | 'pro') {
    if (!user) return
    try {
      const res = await fetch('/api/admin/set-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: user.id, plan: mode }),
      })
      if (!res.ok) {
        console.error('[Admin] set-plan 실패:', await res.text())
        return
      }
      // 다른 페이지(프로필/요금제/헤더)의 미리보기 표시를 위해 localStorage도 동기화
      try { localStorage.setItem('admin_plan_mode', mode) } catch {}
      // 실제 plan 기반으로 isPro가 갱신되도록 프로필 + 설정(delivery_method 복구 등) 재로드
      await reloadProfile(user.id)
      await loadData(user.id)
    } catch (e) {
      console.error('[Admin] set-plan 호출 오류:', e)
    }
  }

  const filteredChannels = filterCat ? channels.filter(c => c.category_id === filterCat) : channels
  const getCatById = (id: string | null) => categories.find(c => c.id === id)
  // 검색·필터·보관 기간이 전부 서버 쿼리로 옮겨져 여기서 더 거를 것이 없다.
  // 렌더 쪽 참조가 많아 변수는 그대로 두고 digests를 그대로 가리킨다(회귀 최소화).
  // 무료도 저장은 30일 유지 → 재구독 시 자동 복원.
  const filteredDigests = digests

  // 필터 드롭다운 후보는 개요(필터 미적용)에서 뽑는다.
  // digests에서 뽑으면 채널을 하나 고른 순간 나머지 채널이 목록에서 사라져 되돌아갈 수 없다.
  const uniqueChannels = [...new Set(historyOverview.map(d => d.channel_alias))].sort()
  const uniqueCategories = [...new Set(historyOverview.map(d => d.category_name))]
    .filter((c): c is string => !!c)
    .sort()

  // 메뉴 정의 (탑바 + 모바일 시트 공용)
  const tabs: { key: 'channels' | 'schedule' | 'history'; label: string }[] = [
    { key: 'channels', label: t('nav.channels') },
    { key: 'schedule', label: t('nav.schedule') },
    { key: 'history', label: t('nav.history') },
  ]
  // 탭 뱃지는 열람 기록 필터와 무관해야 하므로 개요에서 센다.
  const breakingUnread = historyOverview.filter(d => d.is_breaking && !d.is_read).length

  // 공통 스타일 토큰
  const logoBox: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 7,
    background: 'var(--accent)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--bg-card)', fontSize: 12, fontWeight: 700,
    flexShrink: 0,
  }
  // 탭 네비/기어/업그레이드 버튼 스타일은 공용 AppHeader로 이동(대시보드에선 제거).
  const breakingBadge: React.CSSProperties = {
    background: 'var(--danger)', color: '#fff',
    fontSize: 10, fontWeight: 600,
    padding: '1px 6px', borderRadius: 999,
    lineHeight: 1.4,
  }
  const dropdownItemStyle: React.CSSProperties = {
    width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: 7,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 10,
    fontFamily: 'inherit',
  }
  const dropdownDivider: React.CSSProperties = {
    height: 1, background: 'var(--border-light)', margin: '6px 4px',
  }

  // 인라인 세그먼티드 토글 (KO/EN)
  function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
    return (
      <div style={{ display: 'inline-flex', background: 'var(--bg-subtle)', borderRadius: 6, padding: 2 }}>
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            style={{
              padding: '2px 8px', borderRadius: 4,
              background: value === opt ? 'var(--bg-card)' : 'transparent',
              color: value === opt ? 'var(--text-primary)' : 'var(--text-tertiary)',
              border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: value === opt ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}>
            {opt}
          </button>
        ))}
      </div>
    )
  }

  // 작은 on/off 스위치
  function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
    return (
      <div onClick={onChange} role="button"
        style={{
          width: 32, height: 18, borderRadius: 999,
          background: on ? 'var(--accent)' : 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          position: 'relative', cursor: 'pointer',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}>
        <div style={{
          position: 'absolute', top: 1, left: on ? 15 : 1,
          width: 14, height: 14, borderRadius: '50%',
          background: on ? 'var(--bg-card)' : 'var(--text-tertiary)',
          transition: 'left 0.2s',
        }} />
      </div>
    )
  }

  // 설정 메뉴 항목 렌더 (드롭다운 / 모바일 시트 공용)
  function renderSettingsItems(closeMenu: () => void) {
    const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
    return (
      <>
        {/* 사용자 헤더 */}
        <button
          style={{ ...dropdownItemStyle, padding: '10px 12px' }}
          onClick={() => { closeMenu(); router.push('/profile') }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </span>
          </div>
          <UserPlanBadge plan={plan} size="sm" />
        </button>

        <div style={dropdownDivider} />

        {/* 언어 (하위 메뉴: 데스크탑=플라이아웃 / 모바일=아코디언) */}
        <LanguageSubmenu
          locale={locale}
          label={t('settings.language')}
          itemStyle={dropdownItemStyle}
          isMobile={isMobile}
          onSelect={(l) => { closeMenu(); changeLocale(l) }}
        />

        <button style={dropdownItemStyle} onClick={() => { closeMenu(); setShowHelp(true) }}>
          {t('settings.help')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/terms') }}>
          {t('settings.terms')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/privacy') }}>
          {t('settings.privacy')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/refund') }}>
          {t('settings.refund')}
        </button>

        {isAdmin && (
          <>
            <div style={dropdownDivider} />
            <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/admin') }}>
              {t('admin.adminMode')}
            </button>
          </>
        )}

        {plan === 'FREE' && (
          <>
            <div style={dropdownDivider} />
            <div style={{ padding: '4px 6px 6px' }}>
              <button onClick={() => { closeMenu(); router.push('/pricing') }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                {t('nav.proUpgrade')}
              </button>
            </div>
          </>
        )}

        <div style={dropdownDivider} />

        <button style={dropdownItemStyle} onClick={() => { closeMenu(); logout() }}>
          {t('settings.logout')}
        </button>
      </>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100dvh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      position: 'relative',
    }}>
      {/* =============== 상단 헤더 (공용 AppHeader 사용) =============== */}
      {/* 대시보드 전용 요소(탭·업그레이드·관리자 토글·모바일 사이드바 열기·도움말)는 prop 주입.
          설정 드롭다운/테마 토글은 AppHeader가 담당. 모바일 사이드바는 아래 대시보드 고유 패널 유지. */}
      <AppHeader
        showTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as typeof activeTab)}
        breakingUnread={breakingUnread}
        onOpenSidebar={() => setSidebarOpen(true)}
        adminPlanMode={isPro ? 'pro' : 'free'}
        onAdminPlanModeChange={(mode) => planSwitch.run(() => switchPlanMode(mode))}
        onHelpClick={() => setShowHelp(true)}
      />

      {/* =============== 모바일 우측 슬라이드 시트 =============== */}
      {isMobile && (
        <>
          <div
            onClick={() => setSidebarOpen(false)}
            onTouchEnd={(e) => { e.preventDefault(); setSidebarOpen(false) }}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.35)',
              opacity: sidebarOpen ? 1 : 0,
              pointerEvents: sidebarOpen ? 'auto' : 'none',
              transition: 'opacity 0.25s',
              zIndex: 99,
            }} />
          <aside style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(320px, 85vw)',
            background: 'var(--bg-card)',
            borderLeft: '1px solid var(--border)',
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.25s ease',
            zIndex: 100,
            overflow: 'auto',
            display: 'flex', flexDirection: 'column',
            boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '0.5px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={logoBox}>D</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Daily Video Digest</div>
                <UserPlanBadge plan={plan} size="sm" />
              </div>
              <button onClick={() => setSidebarOpen(false)}
                aria-label={t('nav.closeMenu')}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-secondary)', fontSize: 18, cursor: 'pointer',
                }}>
                ✕
              </button>
            </div>

            <div style={{ padding: '10px 8px' }}>
              {tabs.map(tab => {
                const active = activeTab === tab.key
                return (
                  <button key={tab.key}
                    onClick={() => { setActiveTab(tab.key); setSidebarOpen(false) }}
                    style={{
                      width: '100%',
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: active ? 'var(--bg-subtle)' : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                      border: 'none',
                      fontSize: 14,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                    }}>
                    {tab.label}
                    {tab.key === 'history' && breakingUnread > 0 && (
                      <span style={{ ...breakingBadge, marginLeft: 'auto' }}>{breakingUnread}</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div style={{ height: 0.5, background: 'var(--border-light)', margin: '4px 16px' }} />

            <div style={{ padding: '6px 6px 24px' }}>
              {renderSettingsItems(() => setSidebarOpen(false))}
            </div>
          </aside>
        </>
      )}

      {/* =============== 메인 본문 =============== */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '16px 14px' : '24px 28px', display: 'flex', flexDirection: 'column', flex: 1, width: '100%', boxSizing: 'border-box' }}>

        {/* 각 탭이 자체 헤더(타이틀+서브타이틀)를 갖는다. 공통 헤더는 제거. */}

        {/* 첫 진입 데이터 로딩 구간 — 헤더·탭 바는 그대로 두고 본문 자리에만 뼈대를 표시 */}
        {initialLoading && (
          <SkeletonList count={activeTab === 'schedule' ? 2 : 3} />
        )}

        {/* =============== 채널 탭 (Phase 3: 새 디자인) =============== */}
        {!initialLoading && activeTab === 'channels' && (() => {
          const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
          const todayStr = kstDateStr(0)
          const yesterdayStr = kstDateStr(1)
          // 채널 탭 통계는 열람 기록 탭의 검색·필터에 영향받으면 안 되므로 개요(필터 미적용)에서 센다.
          const todayDigestCount = historyOverview.filter(d => d.created_at?.startsWith(todayStr)).length
          const yesterdayDigestCount = historyOverview.filter(d => d.created_at?.startsWith(yesterdayStr)).length
          const dailyDelta = todayDigestCount - yesterdayDigestCount
          const breakingTotal = historyOverview.filter(d => d.is_breaking).length
          const channelStats = (alias: string) => {
            const list = historyOverview.filter(d => d.channel_alias === alias)
            return {
              today: list.filter(d => d.created_at?.startsWith(todayStr)).length,
              unreadBreaking: list.filter(d => d.is_breaking && !d.is_read).length,
              lastDigest: list[0],
              total: list.length,
            }
          }
          const visibleChannels = filteredChannels.filter(ch =>
            channelSearch.trim() === '' ||
            ch.alias.toLowerCase().includes(channelSearch.trim().toLowerCase())
          )

          // 공통 스타일
          const cardStyle: React.CSSProperties = {
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 10,
            padding: 14,
          }
          const primaryBtn: React.CSSProperties = {
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--bg-card)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }
          const secondaryBtn: React.CSSProperties = {
            padding: '8px 14px',
            borderRadius: 8,
            border: '0.5px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }
          const inputStyle: React.CSSProperties = {
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 7,
            padding: '8px 12px',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }
          const labelStyle: React.CSSProperties = {
            fontSize: 12,
            color: 'var(--text-tertiary)',
            display: 'block',
            marginBottom: 4,
          }
          const rowActionBtn: React.CSSProperties = {
            width: 26, height: 26, borderRadius: 6,
            border: '0.5px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 11,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }

          return (
            <>
              {/* 인삿말 헤더 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
                    {t('dashboard.greeting', { name: userName })}
                  </h1>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                    {t('dashboard.summary', { channels: channels.length, videos: todayDigestCount })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setShowAddCategory(v => !v)} style={secondaryBtn}>
                    {isMobile ? t('dashboard.addCategoryShort') : t('dashboard.addCategory')}
                  </button>
                  <button
                    onClick={() => {
                      if (!isPro && activeChannelCount >= channelLimit) {
                        promptChannelLimit()
                        return
                      }
                      setShowAddChannel(v => !v)
                    }}
                    style={primaryBtn}>
                    {t('dashboard.addChannel')}
                    {!isPro && (
                      <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>
                        ({activeChannelCount}/{channelLimit})
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Pro 업그레이드 배너 (Free + 비관리자만) */}
              {plan === 'FREE' && !isAdmin && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-subtle) 100%)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: 'var(--accent)', color: 'var(--bg-card)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
                  }}>✨</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {t('proBanner.title')}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {t('proBanner.desc')}
                    </div>
                  </div>
                  <button onClick={() => router.push('/pricing')}
                    style={{
                      background: 'transparent',
                      border: '0.5px solid var(--text-primary)',
                      color: 'var(--text-primary)',
                      padding: '6px 12px',
                      borderRadius: 7,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}>
                    {isMobile ? t('proBanner.ctaShort') : t('proBanner.cta')}
                  </button>
                </div>
              )}

              {/* 통계 카드 4개 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
                gap: 10,
                marginBottom: 20,
              }}>
                {(() => {
                  // Free + 활성 채널이 한도(5)에 도달하면 빨간색 강조
                  const limitReached = !isPro && activeChannelCount >= channelLimit
                  return (
                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>{t('stats.subscribed')}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <span style={{
                      fontSize: 22, fontWeight: 600, letterSpacing: -0.5,
                      color: limitReached ? 'var(--danger)' : 'var(--text-primary)',
                    }}>
                      {isPro ? channels.length : activeChannelCount}
                    </span>
                    {!isPro && (
                      <span style={{ fontSize: 12, color: limitReached ? 'var(--danger)' : 'var(--text-tertiary)' }}>/ {channelLimit}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10, marginTop: 4,
                    fontWeight: limitReached ? 500 : 400,
                    color: limitReached ? 'var(--danger)' : 'var(--text-tertiary)',
                  }}>
                    {isPro
                      ? t('stats.proUnlimited')
                      : inactiveChannelCount > 0
                        ? t('stats.lockedCount', { n: inactiveChannelCount })
                        : activeChannelCount >= channelLimit
                          ? t('stats.limit')
                          : t('stats.freeLimit', { n: channelLimit })}
                  </div>
                </div>
                  )
                })()}

                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>{t('stats.todayVideos')}</div>
                  <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: 'var(--text-primary)' }}>
                    {todayDigestCount}
                  </div>
                  <div style={{
                    fontSize: 10, marginTop: 4,
                    color: dailyDelta > 0 ? 'var(--success)' : 'var(--text-tertiary)',
                  }}>
                    {dailyDelta > 0
                      ? t('stats.compared', { n: dailyDelta })
                      : dailyDelta < 0
                        ? t('stats.comparedDown', { n: dailyDelta })
                        : t('stats.comparedSame')}
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>{t('stats.breaking')}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 600, letterSpacing: -0.5,
                    color: (breakingTotal === 0 && plan === 'FREE') ? 'var(--text-muted)' : 'var(--text-primary)',
                  }}>
                    {(breakingTotal === 0 && plan === 'FREE') ? '—' : breakingTotal}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted)' }}>
                    {plan === 'FREE' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Lock size={11} />{t('stats.proOnly')}
                      </span>
                    ) : t('stats.accumulated')}
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>{t('stats.retention')}</div>
                  <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: 'var(--text-primary)' }}>
                    {retentionDays}{locale === 'ko' ? '일' : 'd'}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted)' }}>
                    {plan === 'FREE' ? t('stats.proRetention') : t('stats.maxRetention')}
                  </div>
                </div>
              </div>

              {/* 카테고리 추가 폼 (토글) */}
              {showAddCategory && (
                <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>{t('channels.newCategoryForm')}</div>
                  <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
                    <input value={newCategory.name}
                      onChange={e => setNewCategory({ ...newCategory, name: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && catAdd.run(addCategory)}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      placeholder={t('channels.categoryName')}
                      style={{ ...inputStyle, flex: 1 }} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddCategory(false); setNewCategory({ name: '', color: '' }) }} style={secondaryBtn}>{t('common.cancel')}</button>
                      <button onClick={() => catAdd.run(addCategory)} disabled={catAdd.pending}
                        style={catAdd.pending ? { ...primaryBtn, ...pendingBtnStyle } : primaryBtn}>
                        {catAdd.pending ? t('common.adding') : t('common.add')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 채널 추가 폼 (토글) */}
              {showAddChannel && (
                <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>{t('channels.newChannelForm')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>{t('common.url')}</label>
                      <input value={newChannel.url}
                        onChange={e => setNewChannel({ ...newChannel, url: e.target.value })}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        placeholder="https://youtube.com/@channelname"
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t('common.alias')}</label>
                      <input value={newChannel.alias}
                        onChange={e => setNewChannel({ ...newChannel, alias: e.target.value })}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        placeholder={t('common.displayName')}
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t('common.category')}</label>
                      <select value={newChannel.category_id}
                        onChange={e => setNewChannel({ ...newChannel, category_id: e.target.value })}
                        style={inputStyle}>
                        <option value="">{t('common.selectNone')}</option>
                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{t('common.emoji')}</label>
                      <input value={newChannel.emoji}
                        onChange={e => setNewChannel({ ...newChannel, emoji: e.target.value })}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        placeholder="📺" maxLength={2}
                        style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowAddChannel(false)} style={secondaryBtn}>{t('common.cancel')}</button>
                    <button onClick={() => chAdd.run(addChannel)} disabled={chAdd.pending}
                      style={chAdd.pending ? { ...primaryBtn, ...pendingBtnStyle } : primaryBtn}>
                      {chAdd.pending ? t('common.adding') : t('common.addSubmit')}
                    </button>
                  </div>
                </div>
              )}

              {/* 미리보기 (가입 직후 1회) — 아직 정기 발송을 못 받아본 사용자에게만 노출.
                  실행 후에는 profile.preview_used_at이 채워져 카드가 사라진다. */}
              {!profile?.preview_used_at && !profile?.first_digest_at && channels.length >= 1 && (
                <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {t('preview.title')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
                    {t('preview.desc')}
                  </div>
                  <button onClick={() => previewRun.run(runPreview)} disabled={previewRun.pending}
                    style={previewRun.pending ? { ...primaryBtn, ...pendingBtnStyle } : primaryBtn}>
                    {previewRun.pending ? t('preview.running') : t('preview.cta')}
                  </button>
                </div>
              )}

              {/* 카테고리 필터 칩 + 검색 */}
              {channels.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <div className="cat-chip-row" style={{ flex: 1, minWidth: 0 }}>
                    <button
                      className={`cat-chip${filterCat === null ? ' active' : ''}`}
                      onClick={() => setFilterCat(null)}
                    >
                      {t('channels.all')}
                      <span style={{
                        color: filterCat === null ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)',
                        fontSize: 11,
                      }}>{channels.length}</span>
                    </button>
                    {categories.map(cat => {
                      const active = filterCat === cat.id
                      const count = channels.filter(c => c.category_id === cat.id).length
                      if (editingCat === cat.id) {
                        return (
                          <div key={cat.id} className="cat-chip" style={{ borderColor: 'var(--accent)' }}>
                            <input
                              autoFocus
                              value={editingCatName}
                              onChange={e => setEditingCatName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') catRename.run(() => updateCategoryName(cat.id, editingCatName))
                                if (e.key === 'Escape') setEditingCat(null)
                              }}
                              style={{
                                background: 'transparent', border: 'none',
                                color: 'var(--text-primary)', fontSize: 12, outline: 'none', width: 80,
                                fontFamily: 'inherit',
                              }}
                            />
                            <span onClick={() => catRename.run(() => updateCategoryName(cat.id, editingCatName))}
                              style={{
                                cursor: 'pointer', color: 'var(--success)', fontSize: 12,
                                ...(catRename.pending ? pendingIconStyle : {}),
                              }}>✓</span>
                            <span onClick={() => setEditingCat(null)}
                              style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>✕</span>
                          </div>
                        )
                      }
                      return (
                        <button
                          key={cat.id}
                          className={`cat-chip${active ? ' active' : ''}`}
                          onClick={() => setFilterCat(cat.id)}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: cat.color, display: 'inline-block', flexShrink: 0 }} />
                          <span>{cat.name}</span>
                          <span style={{
                            color: active ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)',
                            fontSize: 11,
                          }}>{count}</span>
                          <span className="chip-actions">
                            <span onClick={(e) => { e.stopPropagation(); setEditingCat(cat.id); setEditingCatName(cat.name) }}
                              style={{
                                cursor: 'pointer', fontSize: 10, padding: '0 2px',
                                color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                              }}>✎</span>
                            <span onClick={(e) => { e.stopPropagation(); catDelete.run(() => deleteCategory(cat.id)) }}
                              style={{
                                cursor: 'pointer', fontSize: 10, padding: '0 2px',
                                color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                                ...(catDelete.pending ? pendingIconStyle : {}),
                              }}>✕</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {showChannelSearch ? (
                      <input
                        autoFocus
                        value={channelSearch}
                        onChange={e => setChannelSearch(e.target.value)}
                        onBlur={() => { if (!channelSearch) setShowChannelSearch(false) }}
                        placeholder={t('channels.channelSearch')}
                        style={{ ...inputStyle, width: 160, padding: '6px 10px', fontSize: 12 }}
                      />
                    ) : (
                      <button
                        onClick={() => setShowChannelSearch(true)}
                        aria-label={t('channels.channelSearch')}
                        style={{
                          width: 32, height: 32, borderRadius: 7,
                          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                          color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >🔍</button>
                    )}
                  </div>
                </div>
              )}

              {/* Free 안내: 잠긴 채널이 있을 때 */}
              {!isPro && inactiveChannelCount > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-subtle)', border: '0.5px solid var(--border-light)',
                  borderRadius: 9, padding: '10px 14px', marginBottom: 12,
                }}>
                  <Lock size={14} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, lineHeight: 1.5 }}>
                    {t('channels.lockedNotice', { n: channelLimit })}
                  </span>
                  <UpgradeButton label={t('nav.proUpgrade')} style={{ flexShrink: 0 }} />
                </div>
              )}

              {/* 채널 목록 / 빈 상태 */}
              {channels.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'var(--bg-subtle)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, marginBottom: 16,
                  }}>📺</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {t('channels.empty')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 18 }}>
                    {t('channels.emptyDesc')}
                  </div>
                  <button onClick={() => setShowAddChannel(true)} style={{ ...primaryBtn, padding: '10px 18px' }}>
                    {t('channels.emptyCta')}
                  </button>
                </div>
              ) : (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}>
                  {visibleChannels.length === 0 ? (
                    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      {t('channels.noMatch')}
                    </div>
                  ) : visibleChannels.map(ch => {
                    const cat = getCatById(ch.category_id)
                    if (editingChannel === ch.id) {
                      return (
                        <div key={ch.id} style={{
                          padding: 14,
                          borderBottom: '0.5px solid var(--border-light)',
                          background: 'var(--bg-subtle)',
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>{t('channels.editChannel')}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '60px 1fr' : '60px 1fr 1.5fr', gap: 8, marginBottom: 10 }}>
                            <input value={editChannelData.emoji}
                              onChange={e => setEditChannelData({ ...editChannelData, emoji: e.target.value })}
                              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                              placeholder="📺" maxLength={2}
                              style={{ ...inputStyle, textAlign: 'center', padding: 8 }} />
                            <input value={editChannelData.alias}
                              onChange={e => setEditChannelData({ ...editChannelData, alias: e.target.value })}
                              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                              placeholder={t('common.alias')} style={inputStyle} />
                            <input value={editChannelData.url}
                              onChange={e => setEditChannelData({ ...editChannelData, url: e.target.value })}
                              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                              placeholder={t('common.url')}
                              style={{ ...inputStyle, ...(isMobile ? { gridColumn: '1 / -1' } : {}) }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setEditingChannel(null); setEditChannelData({ alias: '', emoji: '', url: '' }) }}
                              style={secondaryBtn}>{t('common.cancel')}</button>
                            <button onClick={() => chUpdate.run(() => updateChannel(ch.id))} disabled={chUpdate.pending}
                              style={chUpdate.pending ? { ...primaryBtn, ...pendingBtnStyle } : primaryBtn}>
                              {chUpdate.pending ? t('common.saving') : t('common.save')}
                            </button>
                          </div>
                        </div>
                      )
                    }
                    const st = channelStats(ch.alias)
                    const dotColor = st.unreadBreaking > 0
                      ? 'var(--danger)'
                      : st.today > 0
                        ? 'var(--text-tertiary)'
                        : 'var(--border)'
                    const infoText = st.unreadBreaking > 0
                      ? t('channels.breakingCount', { n: st.unreadBreaking })
                      : st.today > 0
                        ? t('channels.newVideo', { n: st.today })
                        : st.total > 0
                          ? t('channels.accumulated', { n: st.total })
                          : t('channels.noNew')
                    const timeText = st.lastDigest ? timeAgo(st.lastDigest.created_at, t) : ''
                    // plan 강등으로 비활성화된 채널 (Free 사용자만 잠금 표시)
                    const isLocked = !isPro && ch.is_active === false
                    return (
                      <div key={ch.id} className="channels-row"
                        title={isLocked ? t('channels.lockedTooltip') : undefined}
                        style={isLocked ? { opacity: 0.5 } : undefined}>
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: dotColor, flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 15, flexShrink: 0 }}>{ch.emoji}</span>
                        <span style={{
                          fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: isMobile ? 100 : 220,
                          flexShrink: 0,
                        }}>{ch.alias}</span>
                        {isLocked && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                            background: 'var(--bg-subtle)', color: 'var(--text-tertiary)',
                            padding: '2px 7px', borderRadius: 5, flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}>Pro</span>
                        )}
                        {cat && (
                          <span style={{
                            fontSize: 11,
                            background: 'var(--bg-subtle)',
                            color: 'var(--text-secondary)',
                            padding: '2px 8px',
                            borderRadius: 5,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}>{cat.name}</span>
                        )}
                        {!isMobile && (
                          <span style={{
                            fontSize: 11, color: 'var(--text-tertiary)',
                            flexShrink: 0,
                          }}>{infoText}</span>
                        )}
                        <span style={{
                          marginLeft: 'auto',
                          fontSize: 11, color: 'var(--text-muted)',
                          minWidth: 50, textAlign: 'right',
                          flexShrink: 0,
                        }}>{timeText}</span>
                        <div className="row-actions">
                          {movingChannel === ch.id ? (
                            <select
                              autoFocus
                              defaultValue={ch.category_id ?? ''}
                              onChange={e => chMove.run(() => moveChannel(ch.id, e.target.value))}
                              onBlur={() => setMovingChannel(null)}
                              disabled={chMove.pending}
                              style={{
                                background: 'var(--bg-card)',
                                border: '0.5px solid var(--accent)',
                                borderRadius: 6, padding: '3px 6px',
                                color: 'var(--text-primary)', fontSize: 11,
                                fontFamily: 'inherit',
                              }}>
                              <option value="">{t('common.uncategorized')}</option>
                              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          ) : (
                            <button onClick={() => setMovingChannel(ch.id)} title={t('channels.moveCategory')} style={rowActionBtn}>↔</button>
                          )}
                          <button onClick={() => { setEditingChannel(ch.id); setEditChannelData({ alias: ch.alias, emoji: ch.emoji, url: ch.url }) }}
                            title={t('channels.editChannelTitle')} style={rowActionBtn}>✎</button>
                          <button onClick={() => chDelete.run(() => deleteChannel(ch.id))} disabled={chDelete.pending}
                            title={t('channels.deleteChannel')}
                            style={chDelete.pending ? { ...rowActionBtn, ...pendingIconStyle } : rowActionBtn}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

            </>
          )
        })()}

        {/* =============== 발송 설정 탭 (Phase 4: 새 디자인) =============== */}
        {!initialLoading && activeTab === 'schedule' && (() => {
          const cardStyle: React.CSSProperties = {
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 10,
            padding: 16,
          }
          const primaryBtn: React.CSSProperties = {
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: 'var(--bg-card)',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }
          const disabledBtn: React.CSSProperties = {
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: 'var(--bg-subtle)', color: 'var(--text-muted)',
            cursor: 'not-allowed', fontSize: 13, fontWeight: 600,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }
          const secondaryBtn: React.CSSProperties = {
            padding: '8px 14px', borderRadius: 8,
            border: '0.5px solid var(--border)',
            background: 'transparent', color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 13, fontWeight: 500,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }
          const inputStyle: React.CSSProperties = {
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 7,
            padding: '8px 12px',
            color: 'var(--text-primary)',
            fontSize: 13, fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }
          const sectionTitle: React.CSSProperties = {
            fontSize: 14, fontWeight: 500,
            color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 6,
          }
          const sectionSubtitle: React.CSSProperties = {
            fontSize: 12, color: 'var(--text-tertiary)',
            marginTop: 4, marginBottom: 14,
          }
          const proBadge: React.CSSProperties = {
            fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
            color: 'var(--text-muted)',
            background: 'var(--bg-subtle)',
            padding: '2px 7px', borderRadius: 4,
            whiteSpace: 'nowrap',
          }

          // 발송 채널 목록 — lib/channels.ts 단일 소스 + 언어별 동적 순서.
          const rawMethod: ChannelId = (settings?.delivery_method as ChannelId) ?? 'email'
          // UI 방어: 강등 직후 캐시 등으로 PRO 채널이 남아있어도 무료면 email 선택으로 간주.
          // 목록에 없는 채널(미구현 enabled=false, 알 수 없는 값)이 저장돼 있어도 email로 간주 —
          // 실제 발송도 lib/delivery.ts에서 email로 폴백하므로 표시와 동작이 일치한다.
          const rawDef = CHANNELS.find(c => c.id === rawMethod)
          const currentMethod: ChannelId =
            (!rawDef?.enabled || (rawDef.proOnly && !isPro)) ? 'email' : rawMethod
          const notifChannels = orderedChannels(locale)
            .map(def => ({
              def,
              label: t(def.labelKey),
              selected: currentMethod === def.id,
              locked: def.proOnly && !isPro,
              comingSoon: !def.enabled,
            }))
          const telegramConnected = !!(settings?.telegram_chat_id)

          // 채널 선택(라디오 택1). 준비중/잠금 채널은 선택 대신 안내(이동·모달 없음).
          const selectChannel = (def: typeof CHANNELS[number]) => {
            if (!def.enabled) return
            if (def.proOnly && !isPro) {
              setChannelNotice(t('schedule.proChannelNotice'))
              window.setTimeout(() => setChannelNotice(null), 2500)
              return
            }
            if (currentMethod === def.id) return
            saveSettings({ delivery_method: def.id })
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 페이지 헤더 */}
              <div style={{ marginBottom: 6 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
                  {t('schedule.title')}
                </h1>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  {t('schedule.subtitle')}
                </div>
              </div>

              {/* 발송 시간 */}
              <div style={cardStyle}>
                <div style={sectionTitle}>{t('schedule.sendTime')}</div>
                <div style={sectionSubtitle}>{t('schedule.sendTimeDesc')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    value={pendingSendTime}
                    onChange={e => setPendingSendTime(e.target.value)}
                    style={{
                      ...inputStyle,
                      minWidth: 110,
                      borderColor: sendTimeChanged ? 'var(--accent)' : 'var(--border)',
                    }}>
                    {!sendTimeOptions.includes(pendingSendTime) && (
                      <option value={pendingSendTime}>{pendingSendTime} ({locale === 'ko' ? '현재' : 'current'})</option>
                    )}
                    {sendTimeOptions.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button onClick={() => sendTimeSave.run(saveSendTime)} disabled={!sendTimeChanged || sendTimeSave.pending}
                    style={sendTimeSave.pending
                      ? { ...primaryBtn, ...pendingBtnStyle }
                      : sendTimeChanged ? primaryBtn : disabledBtn}>
                    {sendTimeSave.pending ? t('common.saving') : t('common.save')}
                  </button>
                  {sendTimeStatus === 'saved' && (
                    <span style={{ fontSize: 12, color: 'var(--success)' }}>{t('common.saved')}</span>
                  )}
                  {sendTimeChanged && sendTimeStatus !== 'saved' && (
                    <span style={{ fontSize: 12, color: 'var(--warning)' }}>{t('common.changed')}</span>
                  )}
                </div>
              </div>

              {/* 알림 채널 */}
              <div style={cardStyle}>
                <div style={sectionTitle}>{t('schedule.channels')}</div>
                <div style={sectionSubtitle}>{t('schedule.channelsDesc')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {notifChannels.map(ch => {
                    const Icon = channelIcons[ch.def.id]
                    const interactive = ch.def.enabled && !ch.locked
                    const dimmed = ch.comingSoon || ch.locked
                    return (
                      <div key={ch.def.id}>
                        <div
                          onClick={() => selectChannel(ch.def)}
                          onMouseEnter={e => { if (interactive && !ch.selected) e.currentTarget.style.background = 'var(--bg-subtle)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 7,
                            cursor: ch.comingSoon ? 'default' : (interactive ? 'pointer' : 'default'),
                            background: 'transparent',
                            transition: 'background 0.15s',
                            opacity: dimmed ? 0.55 : 1,
                          }}>
                          {/* 라디오 (택1) */}
                          <span style={{
                            width: 14, height: 14, borderRadius: '50%',
                            border: ch.selected ? '4px solid var(--accent)' : '1px solid var(--border)',
                            background: 'var(--bg-card)',
                            boxSizing: 'border-box',
                            flexShrink: 0,
                            transition: 'border 0.15s',
                          }} />
                          <span style={{
                            display: 'inline-flex', alignItems: 'center',
                            color: dimmed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                            flexShrink: 0,
                          }}>
                            <Icon size={14} />
                          </span>
                          <span style={{
                            fontSize: 13,
                            color: dimmed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                          }}>
                            {ch.label}
                          </span>
                          {ch.locked && (
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, ...proBadge }}>
                              <Lock size={10} /> Pro
                            </span>
                          )}
                          {!ch.locked && ch.comingSoon && (
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
                              {t('schedule.comingSoon')}
                            </span>
                          )}
                        </div>

                        {/* 선택된 채널 바로 아래 주소 입력칸 */}
                        {ch.selected && interactive && ch.def.id === 'email' && (
                          <div style={{ padding: '4px 4px 12px 46px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, alignItems: isMobile ? 'stretch' : 'center' }}>
                              <input
                                type="email"
                                value={pendingEmail}
                                onChange={e => setPendingEmail(e.target.value)}
                                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                onBlur={e => (e.currentTarget.style.borderColor = emailChanged ? 'var(--accent)' : 'var(--border)')}
                                placeholder="your@email.com"
                                style={{ ...inputStyle, flex: 1, borderColor: emailChanged ? 'var(--accent)' : 'var(--border)' }} />
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                                {emailStatus === 'saved' && (
                                  <span style={{ fontSize: 12, color: 'var(--success)' }}>{t('common.saved')}</span>
                                )}
                                {emailChanged && emailStatus !== 'saved' && (
                                  <span style={{ fontSize: 12, color: 'var(--warning)' }}>{t('common.changed')}</span>
                                )}
                                <button onClick={() => emailSave.run(saveEmail)} disabled={!emailChanged || emailSave.pending}
                                  style={emailSave.pending
                                    ? { ...primaryBtn, ...pendingBtnStyle }
                                    : emailChanged ? primaryBtn : disabledBtn}>
                                  {emailSave.pending ? t('common.saving') : t('common.save')}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 텔레그램 선택 시 연결 영역 (3상태: ① 연결 전 / ② 진행 중 / ③ 연결됨).
                            이메일 입력 영역과 동일한 들여쓰기, 별도 테두리 박스 없이 흑백 CSS 변수만 사용. */}
                        {ch.selected && interactive && ch.def.id === 'telegram' && (
                          <div style={{ padding: '4px 4px 12px 46px' }}>
                            {telegramConnected ? (
                              /* ③ 연결 완료 */
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Check size={15} style={{ color: 'var(--text-primary)' }} />
                                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                                    {t('schedule.telegramConnected')}
                                  </span>
                                </div>
                                <button onClick={() => tgDisconnect.run(disconnectTelegram)} disabled={tgDisconnect.pending}
                                  style={{ ...secondaryBtn, ...(tgDisconnect.pending ? pendingBtnStyle : {}), flexShrink: 0 }}>
                                  {tgDisconnect.pending ? t('common.connecting') : t('schedule.telegramDisconnect')}
                                </button>
                              </div>
                            ) : linkPending ? (
                              /* ② 진행 중 */
                              <>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                                    {t('schedule.telegramConnectingDesc', {
                                      bot: (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '') || 'DailyDigest_test_bot',
                                    })}
                                  </div>
                                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                                    {Math.floor(telegramRemaining / 60)}:{String(telegramRemaining % 60).padStart(2, '0')}
                                  </span>
                                </div>
                                {telegramLinkCode && (
                                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <code style={{
                                      flex: 1, minWidth: 0, fontSize: 12, padding: '6px 10px',
                                      background: 'var(--bg-subtle)', borderRadius: 6,
                                      border: '0.5px solid var(--border)',
                                      color: 'var(--text-primary)', fontFamily: 'monospace',
                                      overflowX: 'auto', whiteSpace: 'nowrap',
                                    }}>
                                      {`/start ${telegramLinkCode}`}
                                    </code>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(`/start ${telegramLinkCode}`)
                                        setCodeCopied(true)
                                        setTimeout(() => setCodeCopied(false), 2000)
                                      }}
                                      style={{ ...secondaryBtn, display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                                    >
                                      {codeCopied
                                        ? <><Check size={13} />{t('schedule.telegramCopied')}</>
                                        : <><Copy size={13} />{t('schedule.telegramCopyCode')}</>
                                      }
                                    </button>
                                    <button onClick={cancelTelegramLink} style={{ ...secondaryBtn, flexShrink: 0 }}>
                                      {t('common.cancel')}
                                    </button>
                                  </div>
                                )}
                              </>
                            ) : (
                              /* ① 연결 전 */
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                                  {t('schedule.telegramConnectDesc', {
                                    bot: (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '') || 'DailyDigest_test_bot',
                                  })}
                                </div>
                                <button onClick={() => tgConnect.run(connectTelegram)} disabled={telegramLinking || tgConnect.pending}
                                  style={{
                                    ...(telegramLinking ? disabledBtn : primaryBtn),
                                    ...(tgConnect.pending ? pendingBtnStyle : {}),
                                    flexShrink: 0,
                                  }}>
                                  {tgConnect.pending ? t('common.connecting') : t('schedule.telegramConnect')}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* PRO 전용 채널 안내 토스트 — 결제 토스트와 동일 스타일(하단 중앙 알약).
                    bg=text-primary / 글씨·아이콘=bg-card 라 라이트·다크 양쪽에서 자동 반전·대비됨. */}
                {channelNotice && (
                  <div style={{
                    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
                    padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
                    boxShadow: 'var(--shadow-lg)',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <Lock size={13} color="var(--bg-card)" />
                    {channelNotice}
                  </div>
                )}
              </div>

              {/* 새 영상 없는 날 알림 */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={sectionTitle}>{t('schedule.notifyEmpty')}</div>
                  <div onClick={() => saveSettings({ notify_when_empty: !(settings?.notify_when_empty !== false) })}
                    style={{
                      width: 36, height: 20, borderRadius: 999,
                      background: settings?.notify_when_empty !== false ? 'var(--accent)' : 'var(--bg-subtle)',
                      border: '0.5px solid var(--border)',
                      position: 'relative', cursor: 'pointer',
                      transition: 'background 0.2s', flexShrink: 0,
                    }}>
                    <div style={{
                      position: 'absolute', top: 2, left: settings?.notify_when_empty !== false ? 18 : 2,
                      width: 14, height: 14, borderRadius: '50%',
                      background: settings?.notify_when_empty !== false ? 'var(--bg-card)' : 'var(--text-tertiary)',
                      transition: 'left 0.2s',
                    }} />
                  </div>
                </div>
                {/* 이 카드는 설명이 마지막 요소라 sectionSubtitle의 marginBottom이 카드 바닥에
                    그대로 남는다 → 여기서만 0으로 덮어써 다른 카드와 높이 리듬을 맞춘다.
                    공용 sectionSubtitle은 다른 카드들이 이 여백에 의존하므로 건드리지 않는다. */}
                <div style={{ ...sectionSubtitle, marginBottom: 0 }}>{t('schedule.notifyEmptyDesc')}</div>
              </div>

              {/* 속보 키워드 */}
              <div style={{ ...cardStyle, opacity: isPro ? 1 : 0.85 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={sectionTitle}>{t('schedule.breaking')}</div>
                  {!isPro ? (
                    /* 이 카드의 유일한 잠금 표시 — 입력창 placeholder·추가 버튼에 중복 표기하지 않는다
                       (입력·버튼이 비활성인 것만으로 잠금은 충분히 전달된다). */
                    <span style={{ ...proBadge, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Lock size={11} />{t('schedule.breakingProOnly')}
                    </span>
                  ) : (
                    <div onClick={() => saveSettings({ breaking_alert: !settings?.breaking_alert })}
                      style={{
                        width: 36, height: 20, borderRadius: 999,
                        background: settings?.breaking_alert ? 'var(--accent)' : 'var(--bg-subtle)',
                        border: '0.5px solid var(--border)',
                        position: 'relative', cursor: 'pointer',
                        transition: 'background 0.2s', flexShrink: 0,
                      }}>
                      <div style={{
                        position: 'absolute', top: 2, left: settings?.breaking_alert ? 18 : 2,
                        width: 14, height: 14, borderRadius: '50%',
                        background: settings?.breaking_alert ? 'var(--bg-card)' : 'var(--text-tertiary)',
                        transition: 'left 0.2s',
                      }} />
                    </div>
                  )}
                </div>
                <div style={sectionSubtitle}>{t('schedule.breakingDesc')}</div>

                {/* 키워드 칩 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {(settings?.breaking_keywords ?? ['속보']).map(kw => (
                    <div key={kw} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 999,
                      background: 'var(--bg-subtle)',
                      border: '0.5px solid var(--border)',
                      fontSize: 12, fontWeight: 500,
                      color: 'var(--danger)',
                    }}>
                      <span>{kw}</span>
                      {isPro && (
                        <span onClick={() => kwRemove.run(() => removeKeyword(kw))}
                          style={{
                            cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)',
                            ...(kwRemove.pending ? pendingIconStyle : {}),
                          }}>✕</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* 키워드 추가 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    onKeyDown={e => isPro && e.key === 'Enter' && kwAdd.run(addKeyword)}
                    onFocus={e => isPro && (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                    placeholder={t('schedule.keywordPlaceholder')}
                    disabled={!isPro}
                    style={{ ...inputStyle, flex: 1, opacity: isPro ? 1 : 0.6 }} />
                  <button onClick={() => kwAdd.run(addKeyword)}
                    disabled={!isPro || kwAdd.pending}
                    style={kwAdd.pending
                      ? { ...primaryBtn, ...pendingBtnStyle }
                      : isPro ? primaryBtn : disabledBtn}>
                    {kwAdd.pending ? t('common.adding') : t('common.add')}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* =============== 열람 기록 탭 (Phase 4: 새 디자인) =============== */}
        {!initialLoading && activeTab === 'history' && (() => {
          const cardStyle: React.CSSProperties = {
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 10,
            padding: 16,
          }
          const primaryBtn: React.CSSProperties = {
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: 'var(--bg-card)',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }
          const secondaryBtn: React.CSSProperties = {
            padding: '6px 12px', borderRadius: 7,
            border: '0.5px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 12, fontWeight: 500,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }
          const inputStyle: React.CSSProperties = {
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 7,
            padding: '8px 12px',
            color: 'var(--text-primary)',
            fontSize: 13, fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
            width: '100%',
            transition: 'border-color 0.15s',
          }
          const hasFilter = !!(historySearch || historyDate || historyChannel || historyCategory) || historyFilter !== 'all'
          const formatShortDate = (iso?: string | null) => {
            if (!iso) return '-'
            return new Date(iso).toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' })
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              {/* 페이지 헤더 */}
              <div style={{ marginBottom: 6 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
                  {t('history.title')}
                </h1>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  {t('history.subtitle', { days: retentionDays })}
                </div>
              </div>

              {/* 미리보기 안내 — 미리보기를 쓴 뒤 스팸함 확인을 유도한다.
                  닫음 상태는 localStorage(기기별)로만 관리 — 새 DB 컬럼을 만들지 않는다. */}
              {profile?.preview_used_at && !previewGuideDone && (
                <div style={{ ...cardStyle, position: 'relative' }}>
                  <button onClick={dismissPreviewGuide}
                    aria-label={t('previewGuide.done')}
                    style={{
                      position: 'absolute', top: 10, right: 10,
                      background: 'transparent', border: 'none', padding: 4,
                      cursor: 'pointer', color: 'var(--text-muted)',
                      display: 'inline-flex', alignItems: 'center', lineHeight: 0,
                    }}>
                    <X size={14} />
                  </button>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10, paddingRight: 24 }}>
                    {t('previewGuide.title')}
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <li style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {t('previewGuide.step1')}
                    </li>
                    {/* 스팸함 안내는 이 카드의 핵심 → 본문 톤에서 한 단계 강조 */}
                    <li style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.6 }}>
                      {t('previewGuide.step2')}
                    </li>
                    <li style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {t('previewGuide.step3')}
                    </li>
                  </ol>
                  <button onClick={dismissPreviewGuide} style={{ ...secondaryBtn, marginTop: 12 }}>
                    {t('previewGuide.done')}
                  </button>
                </div>
              )}

              {/* 필터 카드 */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t('history.filters')}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {t('history.total', { n: filteredDigests.length })}
                  </span>
                </div>

                {/* 전체 / 속보만 칩 */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  <button
                    className={`cat-chip${historyFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setHistoryFilter('all')}>
                    {t('history.all')}
                  </button>
                  <button
                    className={`cat-chip${historyFilter === 'breaking' ? ' active' : ''}`}
                    onClick={() => setHistoryFilter('breaking')}>
                    {t('history.breakingOnly')}
                  </button>
                </div>

                {/* 입력 필터들 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1fr',
                  gap: 8,
                }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={historySearch}
                      onChange={e => setHistorySearch(e.target.value)}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      placeholder={t('history.searchPlaceholder')}
                      style={{ ...inputStyle, paddingRight: 32 }}
                    />
                    {historySearch && (
                      <span onClick={() => setHistorySearch('')}
                        style={{
                          position: 'absolute', right: 10, top: '50%',
                          transform: 'translateY(-50%)',
                          cursor: 'pointer', fontSize: 13,
                          color: 'var(--text-muted)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                        ✕
                      </span>
                    )}
                  </div>
                  <input
                    type="date"
                    value={historyDate}
                    onChange={e => setHistoryDate(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                    title={t('history.dateFilter')}
                    style={inputStyle}
                  />
                  <select
                    value={historyChannel}
                    onChange={e => setHistoryChannel(e.target.value)}
                    style={inputStyle}>
                    <option value="">{t('history.allChannels')}</option>
                    {uniqueChannels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                  <select
                    value={historyCategory}
                    onChange={e => setHistoryCategory(e.target.value)}
                    style={inputStyle}>
                    <option value="">{t('history.allCategories')}</option>
                    {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>

                {hasFilter && (
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => {
                      setHistorySearch('')
                      setHistoryDate('')
                      setHistoryChannel('')
                      setHistoryCategory('')
                      setHistoryFilter('all')
                    }} style={secondaryBtn}>
                      {t('history.reset')}
                    </button>
                  </div>
                )}
              </div>

              {/* 기록 목록 / 빈 상태 — 필터 재조회 중에는 목록 자리를 스켈레톤으로 둔다.
                  (historyReload는 usePending이라 200ms 안에 끝나면 스켈레톤이 아예 켜지지 않는다) */}
              {historyReload.pending ? (
                <SkeletonList count={3} />
              ) : filteredDigests.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'var(--bg-subtle)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, marginBottom: 16,
                  }}>📬</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {hasFilter ? t('history.noMatch') : t('history.empty')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 18 }}>
                    {hasFilter ? t('history.noMatchDesc') : t('history.emptyDesc')}
                  </div>
                  {!hasFilter && (
                    <button onClick={() => setActiveTab('channels')}
                      style={{ ...primaryBtn, padding: '10px 18px' }}>
                      {t('history.emptyCta')}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filteredDigests.map((digest, idx) => {
                    const isUnread = digest.is_breaking && !digest.is_read
                    const isExpanded = expandedDigest === digest.id
                    return (
                      <Fragment key={digest.id}>
                        <div
                          onMouseEnter={e => { if (!isUnread) e.currentTarget.style.borderColor = 'var(--text-muted)' }}
                          onMouseLeave={e => { if (!isUnread) e.currentTarget.style.borderColor = 'var(--border)' }}
                          style={{
                            background: 'var(--bg-card)',
                            border: '0.5px solid var(--border)',
                            borderLeftWidth: isUnread ? 3 : 0.5,
                            borderLeftColor: isUnread ? 'var(--danger)' : 'var(--border)',
                            borderRadius: 10,
                            overflow: 'hidden',
                            transition: 'border-color 0.15s',
                          }}>
                          {/* 헤더 (클릭 → 펼침 + 자동 읽음) */}
                          <div onClick={() => {
                            const isOpening = !isExpanded
                            setExpandedDigest(isExpanded ? null : digest.id)
                            if (isOpening) markAsRead(digest.id)
                          }}
                            style={{
                              padding: '14px 16px',
                              display: 'flex', alignItems: 'center', gap: 12,
                              cursor: 'pointer',
                            }}>
                            <div style={{ fontSize: 18, flexShrink: 0 }}>{digest.channel_emoji}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                                {digest.is_breaking && (
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    fontSize: 11, fontWeight: 600,
                                    color: isUnread ? 'var(--danger)' : 'var(--text-muted)',
                                    flexShrink: 0,
                                  }}>
                                    <span style={{
                                      width: 6, height: 6, borderRadius: '50%',
                                      background: 'currentColor',
                                    }} />
                                    {t('history.breakingBadge')}
                                  </span>
                                )}
                                <span style={{
                                  fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                  minWidth: 0,
                                }}>{digest.video_title}</span>
                              </div>
                              <div style={{
                                fontSize: 11, color: 'var(--text-tertiary)',
                                display: 'flex', alignItems: 'center', gap: 6,
                                flexWrap: 'wrap',
                              }}>
                                <span>{digest.channel_alias}</span>
                                {digest.category_name && (
                                  <>
                                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                                    <span>{digest.category_name}</span>
                                  </>
                                )}
                                <span style={{ color: 'var(--text-muted)' }}>·</span>
                                <span>🎬 {formatShortDate(digest.published_at)}</span>
                                <span style={{ color: 'var(--text-muted)' }}>·</span>
                                <span>📅 {formatShortDate(digest.created_at)}</span>
                              </div>
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                              {isExpanded ? '▲' : '▼'}
                            </div>
                          </div>

                          {/* 펼친 영역 */}
                          {isExpanded && (
                            <div style={{
                              padding: '14px 16px 16px',
                              borderTop: '0.5px solid var(--border-light)',
                            }}>
                              {/* 실패·대기·라이브 사유 라벨 (요약 기반 표기는 카드 맨 아래 — 이메일과 동일) */}
                              {(() => {
                                const status = summaryStatusKeys(digest)
                                if (!status) return null
                                return (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{
                                      fontSize: 11, fontWeight: 600,
                                      color: 'var(--text-muted)', letterSpacing: 0.2,
                                    }}>
                                      {t(status.labelKey)}
                                    </div>
                                    {status.noteKey && (
                                      <div style={{
                                        fontSize: 11, color: 'var(--text-muted)',
                                        lineHeight: 1.6, marginTop: 3,
                                      }}>
                                        {t(status.noteKey)}
                                      </div>
                                    )}
                                    {digest.fail_reason === 'pro_only' && (
                                      <button onClick={() => router.push('/pricing')}
                                        style={{
                                          background: 'none', border: 'none', padding: 0,
                                          marginTop: 4, fontSize: 11, color: 'var(--accent)',
                                          cursor: 'pointer', textDecoration: 'underline',
                                          textUnderlineOffset: 2,
                                        }}>
                                        {t('history.proOnlyPricingLink')}
                                      </button>
                                    )}
                                    {isAdmin && digest.fail_detail && (
                                      <div style={{
                                        fontSize: 11, color: 'var(--text-muted)',
                                        fontFamily: 'monospace', marginTop: 3,
                                        wordBreak: 'break-all',
                                      }}>
                                        [debug] {digest.fail_detail}
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}

                              {/* 역피라미드(이메일과 통일): tldr(강조·라벨없음) → 핵심 → timeline */}
                              {/* 상세 요약은 열람기록에서 표시하지 않는다(이메일 전용) — 데이터는 계속 저장됨 */}
                              {/* 실패·대기·라이브 항목은 tldr/요약이 없어 아래 블록이 모두 생략되고 위 라벨이 사유를 설명 */}
                              {!digest.fail_reason && digest.tldr && (
                                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                                  <div style={{
                                    width: 3, borderRadius: 2,
                                    background: 'var(--text-primary)', flexShrink: 0,
                                  }} />
                                  <div style={{
                                    fontSize: 14.5, fontWeight: 600,
                                    color: 'var(--text-primary)', lineHeight: 1.6,
                                  }}>
                                    {digest.tldr}
                                  </div>
                                </div>
                              )}

                              {/* 핵심 포인트 — 불릿 없이 "앵커 — 설명" 한 줄, 앵커만 세미볼드(4채널 공통) */}
                              {digest.key_points?.length > 0 && (
                                <div style={{
                                  background: 'var(--bg-subtle)', borderRadius: 8,
                                  padding: '14px 15px', marginBottom: 20,
                                }}>
                                  <div style={{
                                    fontSize: 11, color: 'var(--text-muted)',
                                    fontWeight: 600, marginBottom: 9, letterSpacing: 0.6,
                                  }}>
                                    {t('history.keyPoints')}
                                  </div>
                                  {digest.key_points.map((p, i) => {
                                    // 새 형식은 상세 요약과 같은 `**앵커.**` 마커 → 볼드 변환만.
                                    // 마커가 없는 과거 형식('앵커 — 부연')만 splitKeyPointPrefix로 앞부분을 굵게.
                                    const segs = splitBoldSegments(p)
                                    const legacy = segs.some(s => s.bold) ? null : splitKeyPointPrefix(p)
                                    const prefix = legacy?.prefix
                                    return (
                                      <div key={i} style={{
                                        fontSize: 13, color: 'var(--text-secondary)',
                                        marginBottom: 9, lineHeight: 1.6,
                                      }}>
                                        {prefix && (
                                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                            {prefix}{' — '}
                                          </span>
                                        )}
                                        {(legacy ? splitBoldSegments(legacy.rest) : segs).map((seg, j) =>
                                          seg.bold
                                            ? <strong key={j} style={{ color: 'var(--text-primary)' }}>{seg.text}</strong>
                                            : <span key={j}>{seg.text}</span>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}

                              {digest.timeline?.length > 0 && (
                                <div style={{ marginBottom: 20 }}>
                                  <div style={{
                                    fontSize: 11, color: 'var(--text-muted)',
                                    fontWeight: 600, marginBottom: 9, letterSpacing: 0.6,
                                  }}>
                                    {t('history.timeline')}
                                  </div>
                                  {digest.timeline.map((t, i) => (
                                    <div key={i} style={{
                                      fontSize: 12, color: 'var(--text-secondary)',
                                      marginBottom: 4, lineHeight: 1.6,
                                    }}>
                                      <span style={{
                                        display: 'inline-block',
                                        background: 'var(--bg-subtle)',
                                        color: 'var(--text-primary)',
                                        padding: '1px 6px', borderRadius: 4,
                                        marginRight: 8,
                                        fontSize: 11, fontWeight: 500,
                                      }}>{t.time}</span>
                                      {t.content}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <a href={digest.video_url} target="_blank" rel="noreferrer"
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'var(--danger)', color: '#fff',
                                    padding: '8px 14px', borderRadius: 7,
                                    textDecoration: 'none',
                                    fontSize: 12, fontWeight: 600,
                                  }}>
                                  {t('history.watchVideo')}
                                </a>
                                {/* 공유 — 요약이 있는 항목만 (실패·대기 항목은 공유할 내용이 없음) */}
                                {!digest.fail_reason && (
                                  <button
                                    onClick={() => setShareTarget({
                                      videoId: digest.video_id,
                                      title: digest.video_title,
                                      tldr: digest.tldr ?? '',
                                      summary: digest.summary ?? '',
                                      timeline: digest.timeline ?? [],
                                      keyPoints: digest.key_points ?? [],
                                    })}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                                      color: 'var(--text-secondary)',
                                      padding: '8px 14px', borderRadius: 7,
                                      fontSize: 12, fontWeight: 600,
                                      cursor: 'pointer', fontFamily: 'inherit',
                                    }}>
                                    <Share2 size={13} /> 공유
                                  </button>
                                )}
                              </div>

                              {/* 요약 기반 표기 — 이메일과 동일하게 카드 맨 아래(영상 보기 버튼 아래) */}
                              {(() => {
                                const basis = summaryBasisKeys(digest)
                                if (!basis) return null
                                return (
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14 }}>
                                    {t(basis.labelKey)}
                                    {basis.noteKey && (
                                      <div style={{ lineHeight: 1.6, marginTop: 3 }}>
                                        {t(basis.noteKey)}
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                        {/* 목록 안 광고는 스크롤 초반 이 한 자리뿐이다. 나머지 한 자리는 목록 맨 아래에 둔다
                            (중간에 끼우면 어정쩡하게 보임). N개마다 반복하는 규칙으로 일반화하지 말 것 —
                            다이나믹 배너가 iframe이라 개수만큼 외부 로딩이 붙는데, CPA 모델이라
                            반복 노출의 수익 기여는 거의 없다. */}
                        {idx === 4 && filteredDigests.length > 5 && !isPro && <AdCard source="history" t={t} />}
                      </Fragment>
                    )
                  })}
                </div>
              )}

              {/* 다음 페이지 불러오기 — 남은 기록이 있을 때만. 누르는 즉시 비활성(중복 요청 방지). */}
              {hasMoreDigests && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={loadMoreDigests}
                    disabled={loadMore.pending}
                    style={{
                      ...secondaryBtn,
                      padding: '10px 20px',
                      ...(loadMore.pending ? pendingBtnStyle : {}),
                    }}>
                    {loadMore.pending ? t('history.loadingMore') : t('history.loadMore')}
                  </button>
                </div>
              )}

              {/* 목록 맨 아래 광고 — 무료 사용자 한정, 두 자리 중 나머지 하나.
                  "더 보기" 아래·Pro 전환 안내 위에 둔다. 안내가 항상 마지막이어야 둘이 경쟁하지 않는다.
                  5개 이하일 때는 아래 하단 광고가 그 역할을 하므로 여기선 제외한다(중복 방지).
                  화면 고정(position: fixed)은 쓰지 않는다 — 하단 중앙 토스트·하단 우측 "맨 위로"와 겹친다. */}
              {!isPro && filteredDigests.length > 5 && (
                <div style={{ paddingTop: 32 }}>
                  <AdCard source="history" t={t} />
                </div>
              )}

              {/* FREE 7일 제한 안내 (숨겨진 기록이 있을 때만).
                  Pro 업그레이드 유도 문구라 Pro에게는 숨겨진 기록이 있어도 띄우지 않는다. */}
              {!isPro && hiddenByRetentionCount > 0 && (
                <div style={{
                  marginTop: 14, padding: '14px 16px',
                  background: 'var(--bg-subtle)', border: '0.5px solid var(--border)',
                  borderRadius: 10, textAlign: 'center',
                  display: 'flex', flexWrap: 'wrap', gap: 8,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {t('history.freeRetentionNotice')}
                  </span>
                  <UpgradeButton label={t('nav.proUpgrade')} />
                </div>
              )}

              {/* 광고 카드 — 무료 사용자 한정. 6개 이상이면 목록 안에 삽입되므로,
                  1~5개일 때만 PRO 안내 뒤 맨 끝에 1개 렌더 → 짧은 목록에서도 광고가 0개가 되지 않는다
                  (기록 0개면 0개). marginTop:auto로 화면 최하단 밀착(래퍼 flex:1 필요). */}
              {filteredDigests.length > 0 && filteredDigests.length <= 5 && !isPro && (
                <div style={{ marginTop: 'auto', paddingTop: 32, marginBottom: 8 }}>
                  <AdCard source="history" t={t} />
                </div>
              )}
            </div>
          )
        })()}

        {/* 광고 카드 + 의견 보내기 스트립 — 채널 탭 최하단 한정 (발송 설정·열람기록 탭에는 없음) */}
        {!initialLoading && activeTab === 'channels' && (
          <>
            {/* 의견 보내기 스트립 — 채널 탭 최하단 한정 (채널 목록 바로 아래 이어짐) */}
            <div style={{
              marginTop: 24, padding: '14px 16px',
              background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('feedback.dashboardPrompt')}</span>
              <button onClick={() => router.push('/feedback')} style={{
                padding: '8px 14px', borderRadius: 8, border: '0.5px solid var(--border)',
                background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 500,
                fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{t('feedback.title')}</button>
            </div>

            {/* 광고 카드 — 무료 사용자 한정, 화면 최하단 밀착(footer 방식).
                marginTop:auto가 flex 컬럼에서 남는 공간을 위로 밀어 광고를 바닥에 붙인다. */}
            {!isPro && (
              <div style={{ marginTop: 'auto', paddingTop: 32, marginBottom: 8 }}>
                <AdCard source="dashboard" t={t} />
              </div>
            )}
          </>
        )}
      </main>

      {/* 열람 기록 "맨 위로" 버튼 (히스토리 탭 + 일정량 스크롤 시) — 공유 페이지와 공용 컴포넌트 */}
      <ScrollTopButton label={t('history.scrollTop')} enabled={activeTab === 'history'} />

      {/* 요약 공유 시트 */}
      {shareTarget && (
        <ShareSheet
          videoId={shareTarget.videoId}
          videoTitle={shareTarget.title}
          tldr={shareTarget.tldr}
          keyPoints={shareTarget.keyPoints}
          summary={shareTarget.summary}
          timeline={shareTarget.timeline}
          userName={user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'}
          t={t}
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* 처음 사용자 도움말 팝업 (자동 노출 + 설정에서 재열기) */}
      {showHelp && (
        <HelpPopup t={t} isMobile={isMobile} initialDontShow={settings?.help_seen ?? false} onClose={closeHelp} />
      )}

      {/* Pro 체험·1개월권 종료 안내 팝업 (전날 ending / 당일 ended) */}
      {trialPopup && (
        <TrialPopup
          variant={trialPopup}
          planKind={profile?.plan_status === 'onetime' ? 'onetime' : 'trial'}
          endDateLabel={profile?.plan_expires_at
            ? new Date(profile.plan_expires_at).toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' })
            : ''}
          t={t}
          onClose={() => closeTrialPopup(false)}
          onSubscribe={() => closeTrialPopup(true)}
        />
      )}

      {/* 미리보기 결과 토스트 — 결제/PRO 안내 토스트와 동일 스타일(하단 중앙 알약).
          bg=text-primary / 글씨=bg-card 라 라이트·다크 양쪽에서 자동 반전·대비됨. */}
      {previewToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 110, background: 'var(--text-primary)', color: 'var(--bg-card)',
          padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)',
        }}>
          {previewToast}
        </div>
      )}
    </div>
  )
}
