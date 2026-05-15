'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Category, Channel, Settings, Digest } from '@/lib/supabase'

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

function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return '방금'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}일 전`
  const week = Math.floor(day / 7)
  if (week < 4) return `${week}주 전`
  const month = Math.floor(day / 30)
  return `${month}개월 전`
}

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [digests, setDigests] = useState<Digest[]>([])
  const [activeTab, setActiveTab] = useState<'channels' | 'schedule' | 'history'>('channels')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [filterCat, setFilterCat] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'breaking'>('all')
  const [historySearch, setHistorySearch] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [usageStats, setUsageStats] = useState<{
    today: {
      gemini: { count: number; input_tokens: number; output_tokens: number }
      youtube: { count: number }
      supadata: { count: number }
    }
    thisMonth: {
      gemini: { count: number; input_tokens: number; output_tokens: number }
      youtube: { count: number }
      supadata: { count: number }
    }
    last7Days: { date: string; gemini: number; youtube: number; supadata: number }[]
    users: { total: number; activeToday: number; activeThisMonth: number }
  } | null>(null)
  const [historyDate, setHistoryDate] = useState('')
  const [historyChannel, setHistoryChannel] = useState('')
  const [historyCategory, setHistoryCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
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
  const [sendTimeStatus, setSendTimeStatus] = useState<'idle' | 'saved'>('idle')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saved'>('idle')

  // --- Phase 2: 새 디자인용 UI 상태 ---
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [lang, setLang] = useState<'KO' | 'EN'>('KO')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  // 실제 구독 상태 (지금은 항상 false. 추후 결제 연동 시 settings/profile에서 가져옴)
  const [isPro, setIsPro] = useState(false)
  // 관리자 전용 임시 모드 토글 ('free' | 'pro') — localStorage에 영속화
  const [adminPlanMode, setAdminPlanMode] = useState<'free' | 'pro'>('free')
  const plan: 'FREE' | 'PRO' = isPro ? 'PRO' : 'FREE'

  // --- Phase 3: 채널 탭 검색 상태 ---
  const [channelSearch, setChannelSearch] = useState('')
  const [showChannelSearch, setShowChannelSearch] = useState(false)
  // Free 한도 (Pro는 한도 없음 → 렌더에서 '무제한' 처리)
  const channelLimit = 5
  const retentionDays = isPro ? 30 : 7

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/'; return }
      setUser(data.user)
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
      const isAdminUser = adminEmails.includes(data.user.email?.toLowerCase() ?? '')
      setIsAdmin(isAdminUser)

      // 관리자: localStorage에 저장된 임시 모드 복원 / 일반 사용자: 항상 Free
      if (isAdminUser) {
        const savedMode = localStorage.getItem('admin_plan_mode')
        if (savedMode === 'pro') {
          setAdminPlanMode('pro')
          setIsPro(true)
        }
      } else {
        setIsPro(false)
      }

      // 프로필 없으면 자동 생성
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()

      if (!profile) {
        await supabase.from('profiles').insert({
          id: data.user.id,
          name: data.user.user_metadata?.full_name ?? data.user.email,
          email: data.user.email,
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
      }

      loadData(data.user.id)
    })
  }, [])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    if (isAdmin) {
      fetchAdminUsage()
    }
  }, [isAdmin])

  useEffect(() => {
    if (settings) {
      setPendingSendTime(settings.send_time ?? '07:00')
      setPendingEmail(settings.email ?? '')
    }
  }, [settings])

  // 테마 변경을 html data-theme 에 반영
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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

  async function addChannel() {
    if (!newChannel.url.trim()) {
      alert('채널 URL을 입력해 주세요.')
      return
    }
    if (!newChannel.alias.trim()) {
      alert('채널 별칭을 입력해 주세요.')
      return
    }
    await supabase.from('channels').insert({
      user_id: user.id,
      url: newChannel.url.trim(),
      alias: newChannel.alias.trim(),
      emoji: newChannel.emoji,
      category_id: newChannel.category_id || null,
    })
    setNewChannel({ url: '', alias: '', emoji: '📺', category_id: '' })
    setShowAddChannel(false)
    loadData(user.id)
  }

  async function deleteChannel(id: string) {
    const channel = channels.find(c => c.id === id)
    if (!confirm(`${channel?.alias} 채널을 삭제할까요?`)) return
    await supabase.from('channels').delete().eq('id', id)
    loadData(user.id)
  }

  async function addCategory() {
    if (!newCategory.name.trim()) {
      alert('카테고리 이름을 입력해 주세요.')
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
    if (!confirm(`${category?.name} 카테고리를 삭제할까요?\n포함된 채널은 삭제되지 않고 미분류로 이동됩니다.`)) return
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
      alert('채널 별칭을 입력해 주세요.')
      return
    }
    if (!editChannelData.url.trim()) {
      alert('채널 URL을 입력해 주세요.')
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

  async function fetchAdminUsage() {
    try {
      const res = await fetch('/api/admin/usage')
      if (!res.ok) return
      const data = await res.json()
      setUsageStats(data)
    } catch (error) {
      console.error('관리자 사용량 조회 실패:', error)
    }
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
    setLoading(true)
    setMsg('')
    const res = await fetch('/api/digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    })
    const data = await res.json()
    setMsg(data.success ? `✅ ${data.sent}개 영상 요약 발송 완료!` : '❌ 오류가 발생했어요')
    setLoading(false)
    loadData(user.id)
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
    setTheme(t => (t === 'light' ? 'dark' : 'light'))
  }

  function switchPlanMode(mode: 'free' | 'pro') {
    setAdminPlanMode(mode)
    setIsPro(mode === 'pro')
    try { localStorage.setItem('admin_plan_mode', mode) } catch {}
    console.log(`[Admin] Plan mode switched to: ${mode}`)
  }

  const filteredChannels = filterCat ? channels.filter(c => c.category_id === filterCat) : channels
  const getCatById = (id: string | null) => categories.find(c => c.id === id)
  const filteredDigests = digests.filter(d => {
    if (historyFilter === 'breaking' && !d.is_breaking) return false
    if (historySearch && !d.video_title.toLowerCase().includes(historySearch.toLowerCase()) && !d.summary?.toLowerCase().includes(historySearch.toLowerCase())) return false
    if (historyDate && !d.created_at.startsWith(historyDate)) return false
    if (historyChannel && d.channel_alias !== historyChannel) return false
    if (historyCategory && d.category_name !== historyCategory) return false
    return true
  })

  const uniqueChannels = [...new Set(digests.map(d => d.channel_alias))].sort()
  const uniqueCategories = [...new Set(digests.map(d => d.category_name))].filter(Boolean).sort()

  // 메뉴 정의 (탑바 + 모바일 시트 공용)
  const tabs: { key: 'channels' | 'schedule' | 'history'; label: string }[] = [
    { key: 'channels', label: '채널' },
    { key: 'schedule', label: '발송 설정' },
    { key: 'history', label: '열람 기록' },
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
  const planBadgeStyle = (p: 'FREE' | 'PRO'): React.CSSProperties =>
    p === 'PRO'
      ? {
          background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)',
          color: '#FFFFFF',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          padding: '2px 7px', borderRadius: 4,
        }
      : {
          background: 'var(--bg-subtle)',
          color: 'var(--text-tertiary)',
          fontSize: 10, fontWeight: 600, letterSpacing: 0.4,
          padding: '2px 7px', borderRadius: 4,
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
    return (
      <>
        <div style={dropdownSectionTitle}>계정</div>
        <button style={dropdownItemStyle} onClick={() => { console.log('[phase2] open profile modal'); closeMenu() }}>
          <span style={{ fontSize: 14 }}>👤</span> 프로필
        </button>
        <button style={dropdownItemStyle} onClick={() => { console.log('[phase2] navigate /subscription'); closeMenu() }}>
          <span style={{ fontSize: 14 }}>💼</span> 구독 관리
        </button>
        <button style={dropdownItemStyle} onClick={() => { closeMenu(); logout() }}>
          <span style={{ fontSize: 14 }}>🚪</span> 로그아웃
        </button>

        <div style={dropdownDivider} />

        <div style={dropdownSectionTitle}>환경 설정</div>
        <div style={{ ...dropdownItemStyle, cursor: 'default' }}>
          <span style={{ fontSize: 14 }}>🌐</span>
          <span style={{ flex: 1 }}>언어</span>
          <Segmented options={['KO', 'EN']} value={lang} onChange={(v) => { setLang(v as 'KO' | 'EN'); console.log('[phase2] language', v) }} />
        </div>
        <div style={{ ...dropdownItemStyle, cursor: 'default' }}>
          <span style={{ fontSize: 14 }}>🌙</span>
          <span style={{ flex: 1 }}>다크 모드</span>
          <Switch on={theme === 'dark'} onChange={toggleTheme} />
        </div>
        <button style={dropdownItemStyle} onClick={() => { console.log('[phase2] open notification channel modal'); closeMenu() }}>
          <span style={{ fontSize: 14 }}>🔔</span> 알림 채널
        </button>
        <button style={dropdownItemStyle} onClick={() => { console.log('[phase2] open notification time modal'); closeMenu() }}>
          <span style={{ fontSize: 14 }}>⏰</span> 알림 시간
        </button>

        <div style={dropdownDivider} />

        <div style={dropdownSectionTitle}>지원</div>
        <button style={dropdownItemStyle} onClick={() => { console.log('[phase2] navigate /help'); closeMenu() }}>
          <span style={{ fontSize: 14 }}>❓</span> 도움말
        </button>
        <button style={dropdownItemStyle} onClick={() => { console.log('[phase2] navigate /terms'); closeMenu() }}>
          <span style={{ fontSize: 14 }}>📄</span> 이용약관
        </button>

        {plan === 'FREE' && (
          <>
            <div style={dropdownDivider} />
            <div style={{ padding: '4px 6px 6px' }}>
              <button onClick={() => { console.log('[phase2] open upgrade modal'); closeMenu() }}
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
                ✨ Pro 업그레이드
              </button>
            </div>
          </>
        )}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={logoBox}>D</div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Daily Digest</div>
              <span style={planBadgeStyle(plan)}>{plan}</span>
            </div>
            <button onClick={() => setSidebarOpen(true)}
              aria-label="메뉴 열기"
              style={{
                marginLeft: 'auto',
                width: 36, height: 36, borderRadius: 8,
                background: 'transparent', border: 'none',
                color: 'var(--text-primary)', fontSize: 20, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
              ☰
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={logoBox}>D</div>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Daily Digest</div>
                <span style={planBadgeStyle(plan)}>{plan}</span>
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
                <button onClick={() => console.log('[phase2] open upgrade modal')}
                  style={proUpgradeBtn}>
                  Pro 업그레이드
                </button>
              )}
              {/* 관리자 전용 Free/Pro 임시 모드 토글 */}
              {isAdmin && (
                <div title="관리자 전용 미리보기 — 실제 구독 상태가 아닙니다"
                  style={{
                    display: 'inline-flex',
                    background: 'var(--bg-subtle)',
                    borderRadius: 7,
                    padding: 2,
                    border: '0.5px dashed var(--border)',
                  }}>
                  {(['free', 'pro'] as const).map(mode => {
                    const active = adminPlanMode === mode
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
              <button ref={settingsBtnRef} onClick={() => setSettingsOpen(o => !o)}
                aria-label="설정"
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
                <span style={planBadgeStyle(plan)}>{plan}</span>
              </div>
              <button onClick={() => setSidebarOpen(false)}
                aria-label="메뉴 닫기"
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
                    안녕하세요, {userName}님 <span style={{ display: 'inline-block' }}>👋</span>
                  </h1>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                    오늘 <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{channels.length}개 채널</strong>에서{' '}
                    <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{todayDigestCount}개 영상</strong>을 요약했어요
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setShowAddCategory(v => !v)} style={secondaryBtn}>
                    + {isMobile ? '분류' : '카테고리'}
                  </button>
                  <button onClick={() => setShowAddChannel(v => !v)} style={primaryBtn}>
                    + 채널 추가
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
                      속보를 놓치지 않으려면 Pro로 업그레이드
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      무제한 채널 · 정밀 요약 · 30분 단위 속보
                    </div>
                  </div>
                  <button onClick={() => console.log('[phase3] open upgrade modal')}
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
                    {isMobile ? '자세히 →' : '자세히 보기 →'}
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
                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>구독 채널</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: 'var(--text-primary)' }}>
                      {channels.length}
                    </span>
                    {!isPro && (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>/ {channelLimit}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10, marginTop: 4,
                    color: !isPro && channels.length >= channelLimit ? 'var(--danger)' : 'var(--text-tertiary)',
                  }}>
                    {isPro
                      ? '✨ Pro 무제한'
                      : channels.length >= channelLimit
                        ? '⚠ 한도 도달'
                        : `Free 한도 ${channelLimit}개`}
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>오늘 영상</div>
                  <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: 'var(--text-primary)' }}>
                    {todayDigestCount}
                  </div>
                  <div style={{
                    fontSize: 10, marginTop: 4,
                    color: dailyDelta > 0 ? 'var(--success)' : 'var(--text-tertiary)',
                  }}>
                    {dailyDelta > 0 ? `+${dailyDelta} 어제 대비` : dailyDelta < 0 ? `${dailyDelta} 어제 대비` : '= 어제 대비'}
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>속보</div>
                  <div style={{
                    fontSize: 22, fontWeight: 600, letterSpacing: -0.5,
                    color: (breakingTotal === 0 && plan === 'FREE') ? 'var(--text-muted)' : 'var(--text-primary)',
                  }}>
                    {(breakingTotal === 0 && plan === 'FREE') ? '—' : breakingTotal}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted)' }}>
                    {plan === 'FREE' ? '🔒 Pro 전용' : '누적'}
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>기록 보관</div>
                  <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: 'var(--text-primary)' }}>
                    {retentionDays}일
                  </div>
                  <div style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted)' }}>
                    {plan === 'FREE' ? 'Pro: 30일' : '최대 보관'}
                  </div>
                </div>
              </div>

              {/* 카테고리 추가 폼 (토글) */}
              {showAddCategory && (
                <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>새 카테고리</div>
                  <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
                    <input value={newCategory.name}
                      onChange={e => setNewCategory({ ...newCategory, name: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && addCategory()}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      placeholder="카테고리 이름"
                      style={{ ...inputStyle, flex: 1 }} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddCategory(false); setNewCategory({ name: '', color: '' }) }} style={secondaryBtn}>취소</button>
                      <button onClick={addCategory} style={primaryBtn}>추가</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 채널 추가 폼 (토글) */}
              {showAddChannel && (
                <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>새 채널 추가</div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>채널 URL</label>
                      <input value={newChannel.url}
                        onChange={e => setNewChannel({ ...newChannel, url: e.target.value })}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        placeholder="https://youtube.com/@channelname"
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>채널 별칭</label>
                      <input value={newChannel.alias}
                        onChange={e => setNewChannel({ ...newChannel, alias: e.target.value })}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        placeholder="표시할 이름"
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>카테고리</label>
                      <select value={newChannel.category_id}
                        onChange={e => setNewChannel({ ...newChannel, category_id: e.target.value })}
                        style={inputStyle}>
                        <option value="">선택 안함</option>
                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>이모지</label>
                      <input value={newChannel.emoji}
                        onChange={e => setNewChannel({ ...newChannel, emoji: e.target.value })}
                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        placeholder="📺" maxLength={2}
                        style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowAddChannel(false)} style={secondaryBtn}>취소</button>
                    <button onClick={addChannel} style={primaryBtn}>추가하기</button>
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
                      전체
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
                        placeholder="채널 검색"
                        style={{ ...inputStyle, width: 160, padding: '6px 10px', fontSize: 12 }}
                      />
                    ) : (
                      <button
                        onClick={() => setShowChannelSearch(true)}
                        aria-label="채널 검색"
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
                    아직 등록된 채널이 없어요
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 18 }}>
                    관심 있는 유튜브 채널을 추가하면<br />
                    매일 아침 요약을 받아볼 수 있어요
                  </div>
                  <button onClick={() => setShowAddChannel(true)} style={{ ...primaryBtn, padding: '10px 18px' }}>
                    + 첫 번째 채널 추가하기
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
                      일치하는 채널이 없어요
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
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>채널 수정</div>
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
                              placeholder="채널 별칭" style={inputStyle} />
                            <input value={editChannelData.url}
                              onChange={e => setEditChannelData({ ...editChannelData, url: e.target.value })}
                              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                              placeholder="채널 URL"
                              style={{ ...inputStyle, ...(isMobile ? { gridColumn: '1 / -1' } : {}) }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setEditingChannel(null); setEditChannelData({ alias: '', emoji: '', url: '' }) }}
                              style={secondaryBtn}>취소</button>
                            <button onClick={() => updateChannel(ch.id)} style={primaryBtn}>저장</button>
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
                      ? `속보 ${st.unreadBreaking}건`
                      : st.today > 0
                        ? `${st.today}개 영상`
                        : st.total > 0
                          ? `${st.total}개 누적`
                          : '영상 없음'
                    const timeText = st.lastDigest ? timeAgo(st.lastDigest.created_at) : ''
                    return (
                      <div key={ch.id} className="channels-row">
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
                              <option value="">미분류</option>
                              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          ) : (
                            <button onClick={() => setMovingChannel(ch.id)} title="카테고리 이동" style={rowActionBtn}>↔</button>
                          )}
                          <button onClick={() => { setEditingChannel(ch.id); setEditChannelData({ alias: ch.alias, emoji: ch.emoji, url: ch.url }) }}
                            title="채널 수정" style={rowActionBtn}>✎</button>
                          <button onClick={() => deleteChannel(ch.id)} title="채널 삭제" style={rowActionBtn}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 관리자 통계 */}
              {isAdmin && usageStats && (() => {
                const GEMINI_DAILY_LIMIT = 1500
                const todayGemini = usageStats.today.gemini.count
                const pct = Math.min(100, (todayGemini / GEMINI_DAILY_LIMIT) * 100)
                const barColor = pct >= 80 ? 'var(--danger)' : pct >= 50 ? 'var(--warning)' : 'var(--success)'
                const max7d = Math.max(1, ...usageStats.last7Days.map(d => d.gemini + d.youtube + d.supadata))
                const formatNum = (n: number) => n.toLocaleString('en-US')
                const innerCard: React.CSSProperties = {
                  background: 'var(--bg-subtle)',
                  border: '0.5px solid var(--border-light)',
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 10,
                }
                return (
                  <div style={{ ...cardStyle, padding: 18, marginTop: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>🔒 관리자 통계</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Gemini · YouTube · Supadata API 사용 현황 (KST)</div>
                      </div>
                      <button onClick={fetchAdminUsage} style={secondaryBtn}>새로고침</button>
                    </div>

                    {/* 사용자 현황 */}
                    <div style={innerCard}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>👥 사용자 현황</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                        {[
                          { label: '전체', value: usageStats.users.total },
                          { label: '오늘 활동', value: usageStats.users.activeToday },
                          { label: '이번 달', value: usageStats.users.activeThisMonth },
                        ].map(u => (
                          <div key={u.label} style={{
                            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                            borderRadius: 8, padding: 10, textAlign: 'center',
                          }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>{u.label}</div>
                            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: -0.5 }}>
                              {formatNum(u.value)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>명</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Gemini 진행률 */}
                    <div style={innerCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Gemini API</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>무료 한도 {formatNum(GEMINI_DAILY_LIMIT)}건/일</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>오늘</span>
                        <span style={{ fontSize: 20, fontWeight: 600, color: barColor, letterSpacing: -0.5 }}>{formatNum(todayGemini)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>건</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: barColor, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'var(--bg-card)', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 8, fontSize: 11 }}>
                        <div>
                          <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>오늘 입력 토큰</div>
                          <div style={{ color: 'var(--text-primary)' }}>{formatNum(usageStats.today.gemini.input_tokens)}</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>오늘 출력 토큰</div>
                          <div style={{ color: 'var(--text-primary)' }}>{formatNum(usageStats.today.gemini.output_tokens)}</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>이번 달 호출</div>
                          <div style={{ color: 'var(--text-primary)' }}>{formatNum(usageStats.thisMonth.gemini.count)}건</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>이번 달 토큰</div>
                          <div style={{ color: 'var(--text-primary)' }}>
                            {formatNum(usageStats.thisMonth.gemini.input_tokens + usageStats.thisMonth.gemini.output_tokens)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 최근 7일 추이 */}
                    <div style={innerCard}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10 }}>최근 7일 추이 (서비스 합계)</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 70, marginBottom: 6 }}>
                        {usageStats.last7Days.map(d => {
                          const total = d.gemini + d.youtube + d.supadata
                          const heightPct = (total / max7d) * 100
                          return (
                            <div key={d.date} title={`${d.date}\nGemini ${d.gemini} · YouTube ${d.youtube} · Supadata ${d.supadata}`}
                              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                              <div style={{
                                height: `${heightPct}%`,
                                minHeight: total > 0 ? 2 : 0,
                                background: 'linear-gradient(to top, var(--accent), var(--text-tertiary))',
                                borderRadius: 3,
                              }} />
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                        {usageStats.last7Days.map(d => (
                          <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
                            {d.date.slice(5)}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 다른 서비스 */}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 8 }}>
                      <div style={{ ...innerCard, marginBottom: 0, padding: 12 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>YouTube API</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          오늘 <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatNum(usageStats.today.youtube.count)}</span>건
                          <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
                          이번 달 <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatNum(usageStats.thisMonth.youtube.count)}</span>건
                        </div>
                      </div>
                      <div style={{ ...innerCard, marginBottom: 0, padding: 12 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>Supadata API</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          오늘 <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatNum(usageStats.today.supadata.count)}</span>건
                          <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
                          이번 달 <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatNum(usageStats.thisMonth.supadata.count)}</span>건
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
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

          const notifChannels = [
            { id: 'email', label: '이메일', icon: '📧', checked: true, locked: false, fixed: true },
            { id: 'kakao', label: '카카오톡', icon: '💬', checked: false, locked: !isPro, fixed: false },
            { id: 'telegram', label: '텔레그램', icon: '✈️', checked: false, locked: !isPro, fixed: false },
            { id: 'discord', label: '디스코드', icon: '🎮', checked: false, locked: !isPro, fixed: false },
          ]

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 페이지 헤더 */}
              <div style={{ marginBottom: 6 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
                  발송 설정
                </h1>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  다이제스트를 받을 시간과 방법을 설정하세요
                </div>
              </div>

              {/* 발송 시간 */}
              <div style={cardStyle}>
                <div style={sectionTitle}><span>⏰</span> 발송 시간</div>
                <div style={sectionSubtitle}>매일 이 시간에 자동으로 요약을 받아봐요</div>
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
                      <option value={pendingSendTime}>{pendingSendTime} (현재)</option>
                    )}
                    {sendTimeOptions.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button onClick={saveSendTime} disabled={!sendTimeChanged}
                    style={sendTimeChanged ? primaryBtn : disabledBtn}>
                    저장
                  </button>
                  {sendTimeStatus === 'saved' && (
                    <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ 저장됨</span>
                  )}
                  {sendTimeChanged && sendTimeStatus !== 'saved' && (
                    <span style={{ fontSize: 12, color: 'var(--warning)' }}>● 변경됨</span>
                  )}
                </div>
                {!isPro && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'right' }}>
                    💡 Pro 사용자는 여러 시간 설정 가능
                  </div>
                )}
              </div>

              {/* 수신 이메일 */}
              <div style={cardStyle}>
                <div style={sectionTitle}><span>📧</span> 수신 이메일</div>
                <div style={sectionSubtitle}>다이제스트를 받을 이메일 주소</div>
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, alignItems: isMobile ? 'stretch' : 'center' }}>
                  <input
                    type="email"
                    value={pendingEmail}
                    onChange={e => setPendingEmail(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = emailChanged ? 'var(--accent)' : 'var(--border)')}
                    placeholder="your@email.com"
                    style={{
                      ...inputStyle,
                      flex: 1,
                      borderColor: emailChanged ? 'var(--accent)' : 'var(--border)',
                    }} />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                    {emailStatus === 'saved' && (
                      <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ 저장됨</span>
                    )}
                    {emailChanged && emailStatus !== 'saved' && (
                      <span style={{ fontSize: 12, color: 'var(--warning)' }}>● 변경됨</span>
                    )}
                    <button onClick={saveEmail} disabled={!emailChanged}
                      style={emailChanged ? primaryBtn : disabledBtn}>
                      저장
                    </button>
                  </div>
                </div>
              </div>

              {/* 알림 채널 */}
              <div style={cardStyle}>
                <div style={sectionTitle}><span>🔔</span> 알림 채널</div>
                <div style={sectionSubtitle}>다이제스트를 받을 채널을 선택하세요</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {notifChannels.map(ch => (
                    <div key={ch.id}
                      onClick={() => {
                        if (ch.locked) {
                          console.log('[phase4] open upgrade modal — channel:', ch.id)
                        } else if (ch.fixed) {
                          // 이메일은 변경 불가
                        } else {
                          console.log('[phase4] toggle channel:', ch.id)
                        }
                      }}
                      onMouseEnter={e => { if (!ch.fixed) e.currentTarget.style.background = 'var(--bg-subtle)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 7,
                        cursor: ch.fixed ? 'default' : 'pointer',
                        background: 'transparent',
                        transition: 'background 0.15s',
                        opacity: ch.locked ? 0.65 : 1,
                      }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: '0.5px solid var(--border)',
                        background: ch.checked ? 'var(--accent)' : 'var(--bg-card)',
                        color: 'var(--bg-card)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                        flexShrink: 0,
                      }}>
                        {ch.checked ? '✓' : ''}
                      </span>
                      <span style={{
                        fontSize: 13,
                        color: ch.locked ? 'var(--text-tertiary)' : 'var(--text-primary)',
                      }}>
                        {ch.icon} {ch.label}
                      </span>
                      {ch.locked && (
                        <span style={{ marginLeft: 'auto', ...proBadge }}>🔒 Pro</span>
                      )}
                      {ch.fixed && (
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
                          기본
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 속보 키워드 */}
              <div style={{ ...cardStyle, opacity: isPro ? 1 : 0.85 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={sectionTitle}><span>🚨</span> 속보 키워드</div>
                  {!isPro ? (
                    <span style={proBadge}>🔒 Pro 전용</span>
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
                <div style={sectionSubtitle}>영상 제목에 키워드가 있으면 즉시 알림</div>

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
                    placeholder={isPro ? '키워드 추가 (예: 긴급, breaking)' : '🔒 Pro 업그레이드 필요'}
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
                    {isPro ? '+ 추가' : '🔒 Pro'}
                  </button>
                </div>
              </div>

              {/* 지금 바로 실행 */}
              <div style={cardStyle}>
                <div style={sectionTitle}><span>⚡</span> 지금 바로 실행</div>
                <div style={sectionSubtitle}>어제 영상을 지금 요약해서 이메일로 받기</div>
                {msg && (
                  <div style={{
                    fontSize: 12, marginBottom: 10,
                    color: msg.includes('✅') ? 'var(--success)' : 'var(--danger)',
                  }}>{msg}</div>
                )}
                <button onClick={runDigestNow} disabled={loading}
                  style={{
                    ...primaryBtn,
                    padding: '10px 16px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    background: loading ? 'var(--bg-subtle)' : 'var(--accent)',
                    color: loading ? 'var(--text-muted)' : 'var(--bg-card)',
                  }}>
                  {loading ? '요약 중...' : '🚀 지금 실행하기'}
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
            const d = new Date(iso)
            return `${d.getMonth() + 1}.${d.getDate()}.`
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 페이지 헤더 */}
              <div style={{ marginBottom: 6 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
                  열람 기록
                </h1>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  최근 {retentionDays}일간 받은 다이제스트
                </div>
              </div>

              {/* 필터 카드 */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>필터</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    총 {filteredDigests.length}개
                  </span>
                </div>

                {/* 전체 / 속보만 칩 */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  <button
                    className={`cat-chip${historyFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setHistoryFilter('all')}>
                    전체
                  </button>
                  <button
                    className={`cat-chip${historyFilter === 'breaking' ? ' active' : ''}`}
                    onClick={() => setHistoryFilter('breaking')}>
                    🚨 속보만
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
                      placeholder="🔍 제목 또는 내용 검색"
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
                    title="발송일 기준 필터"
                    style={inputStyle}
                  />
                  <select
                    value={historyChannel}
                    onChange={e => setHistoryChannel(e.target.value)}
                    style={inputStyle}>
                    <option value="">모든 채널</option>
                    {uniqueChannels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                  <select
                    value={historyCategory}
                    onChange={e => setHistoryCategory(e.target.value)}
                    style={inputStyle}>
                    <option value="">모든 카테고리</option>
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
                      초기화
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
                    {hasFilter ? '일치하는 기록이 없어요' : '아직 받은 다이제스트가 없어요'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 18 }}>
                    {hasFilter ? (
                      <>필터를 조정해서 다시 검색해 보세요</>
                    ) : (
                      <>채널을 추가하고 발송 시간을 설정하면<br />매일 요약을 받아볼 수 있어요</>
                    )}
                  </div>
                  {!hasFilter && (
                    <button onClick={() => setActiveTab('channels')}
                      style={{ ...primaryBtn, padding: '10px 18px' }}>
                      채널 관리하러 가기 →
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
                                  속보
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
                                  📌 핵심 포인트
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
                                  🕐 타임라인
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
                              ▶ 영상 보기
                            </a>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
      </main>
    </div>
  )
}
