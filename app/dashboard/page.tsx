'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Category, Channel, Settings, Digest } from '@/lib/supabase'

function randomColor(usedColors: string[] = []) {
  const colors = ['#4da6ff', '#47ffb2', '#ff4757', '#c47fff', '#ffaa47', '#ff6b9d', '#00d2d3', '#ffd32a', '#a29bfe', '#fd79a8', '#55efc4', '#fdcb6e']
  const available = colors.filter(c => !usedColors.includes(c))
  const pool = available.length > 0 ? available : colors
  return pool[Math.floor(Math.random() * pool.length)]
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

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/'; return }
      setUser(data.user)

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

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/'
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

  const s = { background: '#0a0a0a', color: '#f0f0f0', minHeight: '100vh', display: 'flex', fontFamily: 'sans-serif' }

  return (
    <div style={s}>
      {/* 사이드바 */}
      {isMobile && (
        <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`${isMobile ? 'sidebar-mobile' : ''} ${sidebarOpen ? 'open' : ''}`}
        style={{ width: 220, minWidth: 220, background: '#111', borderRight: '1px solid #222', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 20px', borderBottom: '1px solid #222' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 20, color: '#e8ff47', fontWeight: 700 }}>DAILY DIGEST</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>YouTube AI 요약 에이전트</div>
        </div>

        <nav style={{ padding: '16px 12px' }}>
          {[
            { key: 'channels', label: '채널 관리', icon: '▦' },
            { key: 'schedule', label: '발송 설정', icon: '◷' },
            { key: 'history', label: '열람 기록', icon: '◈' },
          ].map(item => (
            <div key={item.key} onClick={() => { setActiveTab(item.key as any); if (isMobile) setSidebarOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 2, fontSize: 13, background: activeTab === item.key ? 'rgba(232,255,71,0.12)' : 'transparent', color: activeTab === item.key ? '#e8ff47' : '#666' }}>
              <span>{item.icon}</span>{item.label}
              {item.key === 'history' && digests.filter(d => d.is_breaking).length > 0 && (
                <span style={{ marginLeft: 'auto', background: '#ff4757', color: '#000', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 999 }}>
                  {digests.filter(d => d.is_breaking).length}
                </span>
              )}
            </div>
          ))}
        </nav>

        <div style={{ padding: '0 12px' }}>
          <div style={{ fontSize: 10, color: '#444', letterSpacing: 1.5, textTransform: 'uppercase', padding: '0 8px', marginBottom: 6 }}>카테고리</div>
          <div onClick={() => setFilterCat(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: !filterCat ? '#f0f0f0' : '#666' }}>
            <span style={{ fontSize: 12 }}>◈</span> 전체
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#444' }}>{channels.length}</span>
          </div>
          {categories.map(cat => (
            <div key={cat.id} style={{ marginBottom: 2 }}>
              {editingCat === cat.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px' }}>
                  <input
                    autoFocus
                    value={editingCatName}
                    onChange={e => setEditingCatName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') updateCategoryName(cat.id, editingCatName)
                      if (e.key === 'Escape') setEditingCat(null)
                    }}
                    style={{ flex: 1, background: '#222', border: '1px solid #e8ff47', borderRadius: 4, padding: '3px 6px', color: '#f0f0f0', fontSize: 12, outline: 'none' }}
                  />
                  <span onClick={() => updateCategoryName(cat.id, editingCatName)}
                    style={{ color: '#e8ff47', cursor: 'pointer', fontSize: 11 }}>✓</span>
                  <span onClick={() => setEditingCat(null)}
                    style={{ color: '#666', cursor: 'pointer', fontSize: 11 }}>✕</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, fontSize: 13, color: filterCat === cat.id ? '#f0f0f0' : '#666' }}>
                  <span onClick={() => setFilterCat(cat.id)} style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, flexShrink: 0, display: 'inline-block', cursor: 'pointer' }} />
                  <span onClick={() => setFilterCat(cat.id)} style={{ flex: 1, cursor: 'pointer' }}>{cat.name}</span>
                  <span style={{ fontSize: 11, color: '#444' }}>{channels.filter(c => c.category_id === cat.id).length}</span>
                  <span onClick={() => { setEditingCat(cat.id); setEditingCatName(cat.name) }}
                    style={{ color: '#444', cursor: 'pointer', fontSize: 11, padding: '1px 4px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#e8ff47')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
                    ✎
                  </span>
                  <span onClick={() => deleteCategory(cat.id)}
                    style={{ color: '#444', cursor: 'pointer', fontSize: 11, padding: '1px 4px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
                    ✕
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 'auto', padding: 12, borderTop: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: '#1a1a1a', marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e8ff47', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
            </div>
          </div>
          <button onClick={logout}
            style={{ width: '100%', padding: '7px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 12 }}>
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '12px 16px' : '16px 28px', borderBottom: '1px solid #222', background: '#111', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)}
                style={{ background: 'transparent', border: 'none', color: '#f0f0f0', fontSize: 20, cursor: 'pointer', padding: 4 }}>
                ☰
              </button>
            )}
            <div style={{ fontFamily: 'monospace', fontSize: isMobile ? 16 : 20, fontWeight: 700 }}>
              {activeTab === 'channels' ? '채널 관리' : activeTab === 'schedule' ? '발송 설정' : '열람 기록'}
            </div>
          </div>
          {activeTab === 'channels' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowAddCategory(!showAddCategory)}
                style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>
                + 카테고리
              </button>
              <button onClick={() => setShowAddChannel(!showAddChannel)}
                style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#e8ff47', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + 채널 추가
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: '24px 28px' }}>

          {/* 채널 탭 */}
          {activeTab === 'channels' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: '구독 채널', value: channels.length, unit: '개' },
                  { label: '카테고리', value: categories.length, unit: '개' },
                  { label: '저장된 기록', value: digests.length, unit: '개' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>{s.label}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 28, color: '#e8ff47' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{s.unit}</div>
                  </div>
                ))}
              </div>

              {showAddCategory && (
                <div style={{ background: '#111', border: '1px solid #333', borderRadius: 10, padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>새 카테고리</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input value={newCategory.name} onChange={e => setNewCategory({ ...newCategory, name: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && addCategory()}
                      placeholder="카테고리 이름" style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }} />
                    <button onClick={() => { setShowAddCategory(false); setNewCategory({ name: '', color: '' }) }}
                      style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>
                      취소
                    </button>
                    <button onClick={addCategory}
                      style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#e8ff47', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                      추가
                    </button>
                  </div>
                </div>
              )}

              {showAddChannel && (
                <div style={{ background: '#111', border: '1px solid #333', borderRadius: 10, padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>새 채널 추가</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    {[
                      { label: '채널 URL', key: 'url', placeholder: 'https://youtube.com/@channelname' },
                      { label: '채널 별칭', key: 'alias', placeholder: '표시할 이름' },
                    ].map(f => (
                      <div key={f.key}>
                        <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{f.label}</label>
                        <input value={(newChannel as any)[f.key]} onChange={e => setNewChannel({ ...newChannel, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>카테고리</label>
                      <select value={newChannel.category_id} onChange={e => setNewChannel({ ...newChannel, category_id: e.target.value })}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, boxSizing: 'border-box' }}>
                        <option value="">선택 안함</option>
                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>이모지</label>
                      <input value={newChannel.emoji} onChange={e => setNewChannel({ ...newChannel, emoji: e.target.value })}
                        placeholder="📺" maxLength={2}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowAddChannel(false)}
                      style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>취소</button>
                    <button onClick={addChannel}
                      style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#e8ff47', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>추가하기</button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredChannels.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#444', border: '1px dashed #333', borderRadius: 10 }}>
                    채널을 추가해주세요
                  </div>
                ) : filteredChannels.map(ch => {
                  const cat = getCatById(ch.category_id)
                  if (editingChannel === ch.id) {
                    return (
                      <div key={ch.id} style={{ background: '#111', border: '1px solid #e8ff47', borderRadius: 10, padding: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#e8ff47' }}>채널 수정</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1.5fr', gap: 8, marginBottom: 10 }}>
                          <input value={editChannelData.emoji} onChange={e => setEditChannelData({ ...editChannelData, emoji: e.target.value })}
                            placeholder="📺" maxLength={2}
                            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px', color: '#f0f0f0', fontSize: 13, textAlign: 'center', outline: 'none' }} />
                          <input value={editChannelData.alias} onChange={e => setEditChannelData({ ...editChannelData, alias: e.target.value })}
                            placeholder="채널 별칭"
                            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }} />
                          <input value={editChannelData.url} onChange={e => setEditChannelData({ ...editChannelData, url: e.target.value })}
                            placeholder="채널 URL"
                            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button onClick={() => { setEditingChannel(null); setEditChannelData({ alias: '', emoji: '', url: '' }) }}
                            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 12 }}>취소</button>
                          <button onClick={() => updateChannel(ch.id)}
                            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#e8ff47', color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>저장</button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={ch.id} style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: cat ? cat.color + '22' : '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                        {ch.emoji}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{ch.alias}</div>
                        <div style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.url}</div>
                      </div>
                      {cat && (
                        <div style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: cat.color + '22', color: cat.color, flexShrink: 0 }}>
                          {cat.name}
                        </div>
                      )}
                      {movingChannel === ch.id ? (
                        <select
                          autoFocus
                          defaultValue={ch.category_id ?? ''}
                          onChange={e => moveChannel(ch.id, e.target.value)}
                          onBlur={() => setMovingChannel(null)}
                          style={{ background: '#1a1a1a', border: '1px solid #e8ff47', borderRadius: 6, padding: '4px 8px', color: '#f0f0f0', fontSize: 12, cursor: 'pointer' }}>
                          <option value="">미분류</option>
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      ) : (
                        <button onClick={() => setMovingChannel(ch.id)}
                          title="카테고리 이동"
                          style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 13 }}>
                          ↔
                        </button>
                      )}
                      <button onClick={() => { setEditingChannel(ch.id); setEditChannelData({ alias: ch.alias, emoji: ch.emoji, url: ch.url }) }}
                        title="채널 수정"
                        style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 13 }}>
                        ✎
                      </button>
                      <button onClick={() => deleteChannel(ch.id)}
                        style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 13 }}>✕</button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* 발송 설정 탭 */}
          {activeTab === 'schedule' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>발송 시간</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 40, color: '#e8ff47' }}>{settings?.send_time ?? '07:00'}</div>
                  <div>
                    <input type="time" defaultValue={settings?.send_time ?? '07:00'}
                      onChange={e => saveSettings({ send_time: e.target.value })}
                      style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13 }} />
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>매일 이 시간에 자동 발송</div>
                  </div>
                </div>
              </div>

              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>수신 이메일</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input type="email" defaultValue={settings?.email ?? ''} id="email-input"
                    placeholder="your@gmail.com"
                    style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }} />
                  <button onClick={() => {
                    const val = (document.getElementById('email-input') as HTMLInputElement).value
                    saveSettings({ email: val })
                  }} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#e8ff47', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>저장</button>
                </div>
              </div>

              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>속보 키워드</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>제목에 포함 시 즉시 알림 발송</div>
                  </div>
                  <div onClick={() => saveSettings({ breaking_alert: !settings?.breaking_alert })}
                    style={{ width: 44, height: 24, borderRadius: 999, background: settings?.breaking_alert ? '#e8ff47' : '#333', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 3, left: settings?.breaking_alert ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {(settings?.breaking_keywords ?? ['속보']).map(kw => (
                    <div key={kw} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#ff475722', border: '1px solid #ff4757', fontSize: 13 }}>
                      <span style={{ color: '#ff4757' }}>{kw}</span>
                      <span onClick={() => removeKeyword(kw)} style={{ color: '#ff4757', cursor: 'pointer', fontSize: 11 }}>✕</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addKeyword()}
                    placeholder="키워드 추가 (예: 긴급, breaking)"
                    style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }} />
                  <button onClick={addKeyword}
                    style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#e8ff47', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>추가</button>
                </div>
              </div>

              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>지금 바로 실행</div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>전날 영상을 지금 바로 요약해서 이메일로 발송해요</div>
                {msg && <div style={{ fontSize: 13, marginBottom: 12, color: msg.includes('✅') ? '#47ffb2' : '#ff4757' }}>{msg}</div>}
                <button onClick={runDigestNow} disabled={loading}
                  style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: loading ? '#333' : '#e8ff47', color: '#000', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                  {loading ? '요약 중...' : '🚀 지금 실행하기'}
                </button>
              </div>
            </div>
          )}

          {/* 열람 기록 탭 */}
          {activeTab === 'history' && (
            <>
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {[
                    { key: 'all', label: '전체' },
                    { key: 'breaking', label: '🚨 속보만' },
                  ].map(f => (
                    <div key={f.key} onClick={() => setHistoryFilter(f.key as any)}
                      style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: historyFilter === f.key ? '#1a1a1a' : 'transparent', color: historyFilter === f.key ? '#f0f0f0' : '#666', border: '1px solid #333' }}>
                      {f.label}
                    </div>
                  ))}
                  <div style={{ marginLeft: 'auto', fontSize: 13, color: '#666', display: 'flex', alignItems: 'center' }}>
                    총 {filteredDigests.length}개
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={historySearch}
                      onChange={e => setHistorySearch(e.target.value)}
                      placeholder="🔍 제목 또는 내용 검색"
                      style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 36px 8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                    />
                    {historySearch && (
                      <span onClick={() => setHistorySearch('')}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#666', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f0f0f0')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#666')}>
                        ✕
                      </span>
                    )}
                  </div>
                  <input
                    type="date"
                    value={historyDate}
                    onChange={e => setHistoryDate(e.target.value)}
                    title="발송일 기준 필터"
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }}
                  />
                  <select
                    value={historyChannel}
                    onChange={e => setHistoryChannel(e.target.value)}
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }}>
                    <option value="">모든 채널</option>
                    {uniqueChannels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                  <select
                    value={historyCategory}
                    onChange={e => setHistoryCategory(e.target.value)}
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', color: '#f0f0f0', fontSize: 13, outline: 'none' }}>
                    <option value="">모든 카테고리</option>
                    {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>

                {(historySearch || historyDate || historyChannel || historyCategory) && (
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => {
                      setHistorySearch('')
                      setHistoryDate('')
                      setHistoryChannel('')
                      setHistoryCategory('')
                    }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 12 }}>
                      필터 초기화
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredDigests.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#444', border: '1px dashed #333', borderRadius: 10 }}>
                    아직 기록이 없어요
                  </div>
                ) : filteredDigests.map(digest => (
                  <div key={digest.id} style={{ background: '#111', border: `1px solid ${digest.is_breaking ? '#ff4757' : '#222'}`, borderRadius: 10, overflow: 'hidden' }}>
                    <div onClick={() => setExpandedDigest(expandedDigest === digest.id ? null : digest.id)}
                      style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                      <div style={{ fontSize: 20, flexShrink: 0 }}>{digest.channel_emoji}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          {digest.is_breaking && (
                            <span style={{ background: '#ff4757', color: '#fff', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4 }}>속보</span>
                          )}
                          <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{digest.video_title}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                          {digest.channel_alias} · {digest.category_name} · 🎬 게시일 {digest.published_at ? new Date(digest.published_at).toLocaleDateString('ko-KR') : '-'} · 📅 발송일 {new Date(digest.created_at).toLocaleDateString('ko-KR')}
                        </div>
                      </div>
                      <div style={{ color: '#444', fontSize: 12, flexShrink: 0 }}>
                        {expandedDigest === digest.id ? '▲' : '▼'}
                      </div>
                    </div>

                    {expandedDigest === digest.id && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid #222' }}>
                        <div style={{ paddingTop: 14 }}>
                          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.7, marginBottom: 12 }}>{digest.summary}</div>

                          {digest.key_points?.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#666', fontWeight: 600, marginBottom: 6, letterSpacing: 1 }}>핵심 포인트</div>
                              <ul style={{ margin: 0, paddingLeft: 16 }}>
                                {digest.key_points.map((p, i) => (
                                  <li key={i} style={{ fontSize: 13, color: '#ccc', marginBottom: 4 }}>{p}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {digest.timeline?.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, color: '#666', fontWeight: 600, marginBottom: 6, letterSpacing: 1 }}>타임라인</div>
                              {digest.timeline.map((t, i) => (
                                <div key={i} style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>
                                  <span style={{ background: '#e8ff47', color: '#000', padding: '1px 6px', borderRadius: 4, marginRight: 6, fontSize: 11 }}>{t.time}</span>
                                  {t.content}
                                </div>
                              ))}
                            </div>
                          )}

                          <a href={digest.video_url} target="_blank" rel="noreferrer"
                            style={{ display: 'inline-block', background: '#ff0000', color: '#fff', padding: '7px 14px', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>
                            ▶ 영상 보기
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}