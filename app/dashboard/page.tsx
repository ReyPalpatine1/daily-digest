'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, checkIsPro } from '@/lib/supabase'
import type { Category, Channel, Settings, Digest, Profile } from '@/lib/supabase'
import { normalizeChannelUrl } from '@/lib/channel-url'
import { useTranslation } from '@/lib/i18n/useTranslation'
import UserPlanBadge from '@/components/UserPlanBadge'
import { UpgradeButton } from '@/components/UpgradeButton'
import { LanguageSubmenu } from '@/components/LanguageSubmenu'
import { CHANNELS, orderedChannels, type ChannelId } from '@/lib/channels'
import { Mail, Send, MessageCircle, MessageSquare, Lock } from 'lucide-react'

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

export default function Dashboard() {
  const router = useRouter()
  const { t, locale, changeLocale } = useTranslation()
  const dateLocale = ({ ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' } as Record<string, string>)[locale] ?? 'en-US'
  const [user, setUser] = useState<any>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [digests, setDigests] = useState<Digest[]>([])
  const [activeTab, setActiveTab] = useState<'channels' | 'schedule' | 'history'>('channels')
  // PRO 전용 채널 클릭 시 잠깐 뜨는 안내 문구(결제창 이동 없음)
  const [channelNotice, setChannelNotice] = useState<string | null>(null)
  // 열람 기록 "맨 위로" 버튼: 일정량 스크롤 시 노출
  const [showScrollTop, setShowScrollTop] = useState(false)
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
  const [loading, setLoading] = useState(false)
  const [msgKey, setMsgKey] = useState<{ key: string; params?: Record<string, string | number>; ok?: boolean } | null>(null)
  const [newKeyword, setNewKeyword] = useState('')
  const [expandedDigest, setExpandedDigest] = useState<string | null>(null)

  const [newChannel, setNewChannel] = useState({ url: '', alias: '', emoji: '📺', category_id: '' })
  const [newCategory, setNewCategory] = useState({ name: '', color: '#4da6ff' })

  const [editingCat, setEditingCat] = useState<string | null>(null)
  const [editingCatName, setEditingCatName] = useState('')
  const [movingChannel, setMovingChannel] = useState<string | null>(null)
  const [editingChannel, setEditingChannel] = useState<string | null>(null)
  const [editChannelData, setEditChannelData] = useState({ alias: '', emoji: '', url: '' })

  const [pendingSendTime, setPendingSendTime] = useState('07:00')
  const [pendingEmail, setPendingEmail] = useState('')
  const [pendingTelegram, setPendingTelegram] = useState('')
  const [sendTimeStatus, setSendTimeStatus] = useState<'idle' | 'saved'>('idle')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saved'>('idle')
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'saved'>('idle')

  // --- Phase 2: 새 디자인용 UI 상태 ---
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  // 실제 구독 상태는 profile.plan(free/pro/vip)에서 판정
  const [profile, setProfile] = useState<Profile | null>(null)

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
  // 활성/비활성 채널 수 (plan 강등 시 비활성 채널 존재 가능)
  const activeChannelCount = channels.filter(c => c.is_active !== false).length
  const inactiveChannelCount = channels.length - activeChannelCount

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/'; return }
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

      if (!profileRow) {
        const email = data.user.email ?? ''
        const newProfile = {
          id: data.user.id,
          name: data.user.user_metadata?.full_name ?? email,
          email,
          plan: 'free' as const,
        }
        await supabase.from('profiles').insert(newProfile)
        setProfile({
          ...newProfile,
          plan_expires_at: null,
          vip_granted_by: null,
          vip_granted_at: null,
        })
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
        setProfile(profileRow as Profile)
      }

      // 마지막 접속 기록 (실패해도 무시 - 통계용)
      supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', data.user.id)
        .then(() => {}, () => {})

      loadData(data.user.id)
    })
  }, [])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // "맨 위로" 버튼: 400px 이상 스크롤 시 노출
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (settings) {
      setPendingSendTime(settings.send_time ?? '07:00')
      setPendingEmail(settings.email ?? '')
      setPendingTelegram(settings.telegram_chat_id ?? '')
    }
  }, [settings])

  // 테마 초기 동기화 (layout.tsx bootstrap script 가 이미 html.dataset.theme 설정) +
  // OS 선호도 변경 자동 반영 (사용자가 명시 토글하지 않은 경우에만)
  useEffect(() => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    setTheme(current)

    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onSystemChange(e: MediaQueryListEvent) {
      try { if (localStorage.getItem('theme')) return } catch { return }
      const next: 'light' | 'dark' = e.matches ? 'dark' : 'light'
      setTheme(next)
      document.documentElement.dataset.theme = next
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [])

  // 설정 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!settingsOpen) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (settingsMenuRef.current?.contains(target)) return
      if (settingsBtnRef.current?.contains(target)) return
      setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [settingsOpen])

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
  const currentTelegram = settings?.telegram_chat_id ?? ''
  const sendTimeChanged = pendingSendTime !== currentSendTime
  const emailChanged = pendingEmail !== currentEmail
  const telegramChanged = pendingTelegram !== currentTelegram

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

  // 텔레그램 Chat ID 저장 — 빈 값은 저장 막음(버튼 비활성과 이중 방어).
  async function saveTelegram() {
    if (!telegramChanged || !pendingTelegram.trim()) return
    await saveSettings({ telegram_chat_id: pendingTelegram.trim() })
    setTelegramStatus('saved')
    setTimeout(() => setTelegramStatus('idle'), 1500)
  }

  async function loadData(userId: string) {
    const [{ data: cats }, { data: chs }, { data: sets }, { data: digs }] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', userId),
      supabase.from('channels').select('*').eq('user_id', userId),
      supabase.from('settings').select('*').eq('user_id', userId).single(),
      supabase.from('digests').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
    ])
    const sortedCats = (cats ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    const sortedChs = (chs ?? []).sort((a, b) => a.alias.localeCompare(b.alias, 'ko'))
    setCategories(sortedCats)
    setChannels(sortedChs)
    setSettings(sets)
    setDigests(digs ?? [])
  }

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

  async function runDigestNow() {
    if (!user) return
    if (loading) return // 중복 클릭 방지
    setLoading(true)
    setMsgKey(null)

    // 서버 maxDuration=60s + 네트워크/콜드스타트 여유 = 90s
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90_000)

    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // trigger='manual': 사용자가 일부러 누른 거니 중복 체크 스킵하고 항상 재처리
        body: JSON.stringify({ userId: user.id, trigger: 'manual' }),
        signal: controller.signal,
      })

      if (!res.ok) {
        setMsgKey({ key: 'alerts.digestError' })
        return
      }

      const data = await res.json()
      if (data.success) {
        if (data.empty) {
          setMsgKey({ key: 'alerts.digestEmpty', ok: true })
        } else {
          const n = data.processed ?? data.succeeded ?? data.sent ?? 0
          setMsgKey({ key: 'alerts.digestDone', params: { n }, ok: true })
        }
      } else {
        setMsgKey({ key: 'alerts.digestError' })
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setMsgKey({ key: 'alerts.digestTimeout' })
      } else {
        setMsgKey({ key: 'alerts.digestError' })
      }
      console.error('[runDigestNow] 실패:', err)
    } finally {
      clearTimeout(timeoutId)
      setLoading(false) // 무조건 로딩 해제
      // 부분 처리됐을 수도 있으니 데이터는 다시 로드
      loadData(user.id)
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

  function toggleTheme() {
    const next: 'light' | 'dark' = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch {}
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
  // FREE는 화면에 최근 7일만 표시(저장은 30일 유지 → 재구독 시 자동 복원).
  // plan 미로드 시점(profile null·비관리자)에는 전체표시로 두어 PRO 깜빡임 방지.
  const planLoaded = isAdmin || profile !== null
  const applyFreeRetention = planLoaded && !isPro
  const FREE_HISTORY_DAYS = 7
  const historyRetentionCutoff = Date.now() - FREE_HISTORY_DAYS * 86_400_000
  const beyondFreeRetention = (d: typeof digests[number]) =>
    !!d.created_at && new Date(d.created_at).getTime() < historyRetentionCutoff

  const filteredDigests = digests.filter(d => {
    if (applyFreeRetention && beyondFreeRetention(d)) return false
    if (historyFilter === 'breaking' && !d.is_breaking) return false
    if (historySearch && !d.video_title.toLowerCase().includes(historySearch.toLowerCase()) && !d.summary?.toLowerCase().includes(historySearch.toLowerCase())) return false
    if (historyDate && !d.created_at.startsWith(historyDate)) return false
    if (historyChannel && d.channel_alias !== historyChannel) return false
    if (historyCategory && d.category_name !== historyCategory) return false
    return true
  })

  // FREE에서 7일 제한으로 숨겨진 기록 수 (0이면 안내 숨김)
  const hiddenByRetentionCount = applyFreeRetention
    ? digests.filter(beyondFreeRetention).length
    : 0

  const uniqueChannels = [...new Set(digests.map(d => d.channel_alias))].sort()
  const uniqueCategories = [...new Set(digests.map(d => d.category_name))].filter(Boolean).sort()

  // 메뉴 정의 (탑바 + 모바일 시트 공용)
  const tabs: { key: 'channels' | 'schedule' | 'history'; label: string }[] = [
    { key: 'channels', label: t('nav.channels') },
    { key: 'schedule', label: t('nav.schedule') },
    { key: 'history', label: t('nav.history') },
  ]
  const breakingUnread = digests.filter(d => d.is_breaking && !d.is_read).length

  // 공통 스타일 토큰
  const logoBox: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 7,
    background: 'var(--accent)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--bg-card)', fontSize: 12, fontWeight: 700,
    flexShrink: 0,
  }
  const navBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 7,
    background: active ? 'var(--bg-subtle)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    fontWeight: active ? 500 : 400,
    border: 'none',
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s, color 0.15s',
    fontFamily: 'inherit',
  })
  const gearBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8,
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  const proUpgradeBtn: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 7,
    background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
    color: '#FFFFFF',
    fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }
  const breakingBadge: React.CSSProperties = {
    background: 'var(--danger)', color: '#fff',
    fontSize: 10, fontWeight: 600,
    padding: '1px 6px', borderRadius: 999,
    lineHeight: 1.4,
  }
  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 280,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    padding: 6,
    zIndex: 60,
  }
  const dropdownSectionTitle: React.CSSProperties = {
    fontSize: 10, color: 'var(--text-muted)',
    letterSpacing: 0.8, textTransform: 'uppercase',
    padding: '10px 12px 6px', fontWeight: 600,
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
          onSelect={(l) => { closeMenu(); changeLocale(l, user?.id) }}
        />

        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/profile?tab=help') }}>
          {t('settings.help')}
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); router.push('/terms') }}>
          {t('settings.terms')}
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
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      position: 'relative',
    }}>
      {/* =============== 상단 헤더 =============== */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 56,
        background: 'var(--bg-card)',
        borderBottom: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: isMobile ? '0 14px' : '0 20px',
      }}>
        {isMobile ? (
          <>
            <div
              onClick={() => setActiveTab('channels')}
              role="button"
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <div style={logoBox}>D</div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Daily Digest</div>
              <UserPlanBadge plan={plan} size="sm" />
            </div>
            <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {/* 언어 토글은 설정 드롭다운 안으로 이동 */}
              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <button onClick={() => setSidebarOpen(true)}
                aria-label={t('nav.openMenu')}
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-primary)', fontSize: 20, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                ☰
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div
                onClick={() => setActiveTab('channels')}
                role="button"
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <div style={logoBox}>D</div>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Daily Digest</div>
                <UserPlanBadge plan={plan} size="sm" />
              </div>
              <nav style={{ display: 'flex', gap: 2 }}>
                {tabs.map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    style={navBtnStyle(activeTab === tab.key)}
                    onMouseEnter={e => { if (activeTab !== tab.key) e.currentTarget.style.background = 'var(--bg-subtle)' }}
                    onMouseLeave={e => { if (activeTab !== tab.key) e.currentTarget.style.background = 'transparent' }}>
                    {tab.label}
                    {tab.key === 'history' && breakingUnread > 0 && (
                      <span style={breakingBadge}>{breakingUnread}</span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {plan === 'FREE' && (
                <button onClick={() => router.push('/pricing')}
                  style={proUpgradeBtn}>
                  {t('nav.proUpgrade')}
                </button>
              )}
              {/* 관리자 전용 Free/Pro 임시 모드 토글 */}
              {isAdmin && (
                <div title={t('plans.previewHint')}
                  style={{
                    display: 'inline-flex',
                    background: 'var(--bg-subtle)',
                    borderRadius: 7,
                    padding: 2,
                    border: '0.5px dashed var(--border)',
                  }}>
                  {(['free', 'pro'] as const).map(mode => {
                    const active = (isPro ? 'pro' : 'free') === mode
                    const label = mode === 'pro' ? 'Pro' : 'Free'
                    return (
                      <button key={mode}
                        onClick={() => switchPlanMode(mode)}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-tertiary)' }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 5,
                          background: active ? 'var(--bg-card)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          fontWeight: active ? 500 : 400,
                          boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                          border: 'none',
                          fontSize: 11,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'background 0.15s, color 0.15s',
                        }}>
                        <span style={{ fontSize: 10, opacity: active ? 1 : 0.6 }}>👁</span>
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
              {/* 사용자 / 관리자 모드 토글 (관리자 전용) */}
              {isAdmin && (
                <div style={{
                  display: 'inline-flex',
                  background: 'var(--bg-subtle)',
                  borderRadius: 7,
                  padding: 2,
                }}>
                  <button
                    style={{
                      padding: '4px 10px', borderRadius: 5, border: 'none',
                      background: 'var(--bg-card)', color: 'var(--text-primary)',
                      fontWeight: 500, fontSize: 11, cursor: 'default',
                      fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}>
                    {t('admin.userMode')}
                  </button>
                  <button
                    onClick={() => router.push('/admin')}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                    style={{
                      padding: '4px 10px', borderRadius: 5, border: 'none',
                      background: 'transparent', color: 'var(--text-tertiary)',
                      fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'color 0.15s',
                    }}>
                    {t('admin.adminMode')}
                  </button>
                </div>
              )}
              {/* 언어 토글은 설정 드롭다운 안으로 이동 / 빠른 테마 토글 */}
              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
                title={theme === 'dark' ? t('settings.toLight') : t('settings.toDark')}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 14,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit',
                }}>
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <button ref={settingsBtnRef} onClick={() => setSettingsOpen(o => !o)}
                aria-label={t('common.settings')}
                style={gearBtn}>
                ⚙
              </button>
            </div>
          </>
        )}
      </header>

      {/* =============== 설정 드롭다운 (데스크탑) =============== */}
      {settingsOpen && !isMobile && (
        <div ref={settingsMenuRef} style={dropdownStyle}>
          {renderSettingsItems(() => setSettingsOpen(false))}
        </div>
      )}

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
                <div style={{ fontSize: 15, fontWeight: 600 }}>Daily Digest</div>
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
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '16px 14px' : '24px 28px' }}>

        {/* 각 탭이 자체 헤더(타이틀+서브타이틀)를 갖는다. 공통 헤더는 제거. */}

        {/* =============== 채널 탭 (Phase 3: 새 디자인) =============== */}
        {activeTab === 'channels' && (() => {
          const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '사용자'
          const todayStr = kstDateStr(0)
          const yesterdayStr = kstDateStr(1)
          const todayDigestCount = digests.filter(d => d.created_at?.startsWith(todayStr)).length
          const yesterdayDigestCount = digests.filter(d => d.created_at?.startsWith(yesterdayStr)).length
          const dailyDelta = todayDigestCount - yesterdayDigestCount
          const breakingTotal = digests.filter(d => d.is_breaking).length
          const channelStats = (alias: string) => {
            const list = digests.filter(d => d.channel_alias === alias)
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
                    {plan === 'FREE' ? t('stats.proOnly') : t('stats.accumulated')}
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
                      onKeyDown={e => e.key === 'Enter' && addCategory()}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      placeholder={t('channels.categoryName')}
                      style={{ ...inputStyle, flex: 1 }} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddCategory(false); setNewCategory({ name: '', color: '' }) }} style={secondaryBtn}>{t('common.cancel')}</button>
                      <button onClick={addCategory} style={primaryBtn}>{t('common.add')}</button>
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
                    <button onClick={addChannel} style={primaryBtn}>{t('common.addSubmit')}</button>
                  </div>
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
                                if (e.key === 'Enter') updateCategoryName(cat.id, editingCatName)
                                if (e.key === 'Escape') setEditingCat(null)
                              }}
                              style={{
                                background: 'transparent', border: 'none',
                                color: 'var(--text-primary)', fontSize: 12, outline: 'none', width: 80,
                                fontFamily: 'inherit',
                              }}
                            />
                            <span onClick={() => updateCategoryName(cat.id, editingCatName)}
                              style={{ cursor: 'pointer', color: 'var(--success)', fontSize: 12 }}>✓</span>
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
                            <span onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id) }}
                              style={{
                                cursor: 'pointer', fontSize: 10, padding: '0 2px',
                                color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
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
                  <span style={{ fontSize: 14, flexShrink: 0 }}>🔒</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, lineHeight: 1.5 }}>
                    {t('channels.lockedNotice', { n: channelLimit })}
                  </span>
                  <button onClick={() => router.push('/pricing')}
                    style={{
                      flexShrink: 0, padding: '5px 11px', borderRadius: 7,
                      border: '0.5px solid var(--text-primary)', background: 'transparent',
                      color: 'var(--text-primary)', fontSize: 11, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}>
                    {t('proBanner.ctaShort')}
                  </button>
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
                            <button onClick={() => updateChannel(ch.id)} style={primaryBtn}>{t('common.save')}</button>
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
                          }}>🔒 Pro</span>
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
                              onChange={e => moveChannel(ch.id, e.target.value)}
                              onBlur={() => setMovingChannel(null)}
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
                          <button onClick={() => deleteChannel(ch.id)} title={t('channels.deleteChannel')} style={rowActionBtn}>✕</button>
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
        {activeTab === 'schedule' && (() => {
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
          // (서버 restoreDeliveryToEmail이 복구하면 자동으로 일치한다.)
          const rawDef = CHANNELS.find(c => c.id === rawMethod)
          const currentMethod: ChannelId = (rawDef?.proOnly && !isPro) ? 'email' : rawMethod
          const notifChannels = orderedChannels(locale).map(def => ({
            def,
            label: t(def.labelKey),
            selected: currentMethod === def.id,
            locked: def.proOnly && !isPro, // PRO 전용인데 무료 사용자
            comingSoon: !def.enabled,       // 아직 미구현(카카오/왓츠앱/라인)
          }))

          // 채널 선택(라디오 택1). 준비중/잠금 채널은 선택 대신 안내(이동·모달 없음).
          const selectChannel = (def: typeof CHANNELS[number]) => {
            if (!def.enabled) return // 준비 중 — 선택 불가
            if (def.proOnly && !isPro) {
              // PRO 전용 채널 — 결제창 이동/모달 없이 토스트로만 안내(2.5초)
              setChannelNotice(t('schedule.proChannelNotice'))
              window.setTimeout(() => setChannelNotice(null), 2500)
              return
            }
            if (currentMethod === def.id) return // 이미 선택됨
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
                <div style={sectionTitle}><span>⏰</span> {t('schedule.sendTime')}</div>
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
                  <button onClick={saveSendTime} disabled={!sendTimeChanged}
                    style={sendTimeChanged ? primaryBtn : disabledBtn}>
                    {t('common.save')}
                  </button>
                  {sendTimeStatus === 'saved' && (
                    <span style={{ fontSize: 12, color: 'var(--success)' }}>{t('common.saved')}</span>
                  )}
                  {sendTimeChanged && sendTimeStatus !== 'saved' && (
                    <span style={{ fontSize: 12, color: 'var(--warning)' }}>{t('common.changed')}</span>
                  )}
                </div>
                {!isPro && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'right' }}>
                    {t('schedule.proHint')}
                  </div>
                )}
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
                    const telegramSaveReady = telegramChanged && !!pendingTelegram.trim()
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

                        {/* 선택된 채널 바로 아래 주소 입력칸 펼침 */}
                        {ch.selected && interactive && (
                          <div style={{ padding: '4px 4px 12px 46px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {ch.def.id === 'email' && (
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
                                  <button onClick={saveEmail} disabled={!emailChanged}
                                    style={emailChanged ? primaryBtn : disabledBtn}>
                                    {t('common.save')}
                                  </button>
                                </div>
                              </div>
                            )}
                            {ch.def.id === 'telegram' && (
                              <>
                                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, alignItems: isMobile ? 'stretch' : 'center' }}>
                                  <input
                                    type="text"
                                    value={pendingTelegram}
                                    onChange={e => setPendingTelegram(e.target.value)}
                                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                    onBlur={e => (e.currentTarget.style.borderColor = telegramChanged ? 'var(--accent)' : 'var(--border)')}
                                    placeholder={t('schedule.telegramChatId')}
                                    style={{ ...inputStyle, flex: 1, borderColor: telegramChanged ? 'var(--accent)' : 'var(--border)' }} />
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                                    {telegramStatus === 'saved' && (
                                      <span style={{ fontSize: 12, color: 'var(--success)' }}>{t('common.saved')}</span>
                                    )}
                                    {telegramSaveReady && telegramStatus !== 'saved' && (
                                      <span style={{ fontSize: 12, color: 'var(--warning)' }}>{t('common.changed')}</span>
                                    )}
                                    <button onClick={saveTelegram} disabled={!telegramSaveReady}
                                      style={telegramSaveReady ? primaryBtn : disabledBtn}>
                                      {t('common.save')}
                                    </button>
                                  </div>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                  {t('schedule.telegramHelp')}
                                </div>
                              </>
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
                  <div style={sectionTitle}><span>📭</span> {t('schedule.notifyEmpty')}</div>
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
                <div style={sectionSubtitle}>{t('schedule.notifyEmptyDesc')}</div>
              </div>

              {/* 속보 키워드 */}
              <div style={{ ...cardStyle, opacity: isPro ? 1 : 0.85 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={sectionTitle}><span>🚨</span> {t('schedule.breaking')}</div>
                  {!isPro ? (
                    <span style={proBadge}>{t('schedule.breakingProOnly')}</span>
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
                        <span onClick={() => removeKeyword(kw)}
                          style={{ cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)' }}>✕</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* 키워드 추가 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    onKeyDown={e => isPro && e.key === 'Enter' && addKeyword()}
                    onFocus={e => isPro && (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                    placeholder={isPro ? t('schedule.keywordPlaceholder') : t('schedule.keywordPlaceholderLocked')}
                    disabled={!isPro}
                    style={{ ...inputStyle, flex: 1, opacity: isPro ? 1 : 0.6 }} />
                  <button onClick={() => {
                      if (!isPro) {
                        console.log('[phase4] open upgrade modal — breaking keywords')
                        return
                      }
                      addKeyword()
                    }}
                    style={isPro ? primaryBtn : disabledBtn}>
                    {isPro ? t('common.add') : '🔒 Pro'}
                  </button>
                </div>
              </div>

              {/* 지금 바로 실행 */}
              <div style={cardStyle}>
                <div style={sectionTitle}><span>⚡</span> {t('schedule.runNow')}</div>
                <div style={sectionSubtitle}>{t('schedule.runNowDesc')}</div>
                {msgKey && (
                  <div style={{
                    fontSize: 12, marginBottom: 10,
                    color: msgKey.ok ? 'var(--success)' : 'var(--danger)',
                  }}>{t(msgKey.key, msgKey.params)}</div>
                )}
                <button onClick={runDigestNow} disabled={loading}
                  style={{
                    ...primaryBtn,
                    padding: '10px 16px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    background: loading ? 'var(--bg-subtle)' : 'var(--accent)',
                    color: loading ? 'var(--text-muted)' : 'var(--bg-card)',
                  }}>
                  {loading ? t('schedule.running') : t('schedule.runNowCta')}
                </button>
              </div>
            </div>
          )
        })()}

        {/* =============== 열람 기록 탭 (Phase 4: 새 디자인) =============== */}
        {activeTab === 'history' && (() => {
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 페이지 헤더 */}
              <div style={{ marginBottom: 6 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
                  {t('history.title')}
                </h1>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  {t('history.subtitle', { days: retentionDays })}
                </div>
              </div>

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

              {/* 기록 목록 / 빈 상태 */}
              {filteredDigests.length === 0 ? (
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
                  {filteredDigests.map(digest => {
                    const isUnread = digest.is_breaking && !digest.is_read
                    const isExpanded = expandedDigest === digest.id
                    return (
                      <div key={digest.id}
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
                            <div style={{
                              fontSize: 13, color: 'var(--text-secondary)',
                              lineHeight: 1.7, marginBottom: 14,
                            }}>
                              {digest.summary}
                            </div>

                            {digest.key_points?.length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{
                                  fontSize: 11, color: 'var(--text-tertiary)',
                                  fontWeight: 600, marginBottom: 8, letterSpacing: 0.3,
                                }}>
                                  {t('history.keyPoints')}
                                </div>
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {digest.key_points.map((p, i) => (
                                    <li key={i} style={{
                                      fontSize: 13, color: 'var(--text-secondary)',
                                      marginBottom: 4, lineHeight: 1.6,
                                    }}>{p}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {digest.timeline?.length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{
                                  fontSize: 11, color: 'var(--text-tertiary)',
                                  fontWeight: 600, marginBottom: 8, letterSpacing: 0.3,
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
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* FREE 7일 제한 안내 (숨겨진 기록이 있을 때만) */}
              {hiddenByRetentionCount > 0 && (
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
            </div>
          )
        })()}
      </main>

      {/* 열람 기록 "맨 위로" 버튼 (히스토리 탭 + 일정량 스크롤 시) */}
      {activeTab === 'history' && showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label={t('history.scrollTop')}
          title={t('history.scrollTop')}
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 60,
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)', fontSize: 16,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}>
          ↑
        </button>
      )}
    </div>
  )
}
