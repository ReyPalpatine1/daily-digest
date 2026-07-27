import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { MessageSquareQuote, ShieldOff, Sparkles } from 'lucide-react'
import { getShareByToken } from '@/lib/share'
import { splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'
import ShareVideo from '@/components/ShareVideo'

// 공개 공유 페이지 — 로그인 불필요, 매 요청 조회 (토큰 만료/조회수 반영)
export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ token: string }> }

// 토큰 형식 방어 (generateShareToken은 0-9a-z 12자 — 여유를 두고 8~32자 허용)
function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-z]{8,32}$/.test(token)
}

// 크롤러/미리보기 봇 판정 — 메타는 주되 view_count 증가는 skip
function isBotUA(ua: string): boolean {
  return /bot|crawl|spider|slurp|scrap|preview|facebookexternalhit|whatsapp|telegram|discord|embed/i.test(ua)
}

// "m:ss" / "h:mm:ss" → 초 (파싱 실패 시 0)
function toSeconds(time: string): number {
  const parts = time.split(':').map(p => parseInt(p, 10))
  if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  const fallback: Metadata = {
    title: '공유된 요약 | Daily Video Digest',
    description: '유튜브 영상 AI 요약 공유',
  }
  if (!isValidTokenFormat(token)) return fallback

  const data = await getShareByToken(token)
  if (!data || data.blocked || data.expired || !data.video) return fallback

  const title = data.video.title
  const description =
    (data.summary?.tldr || data.summary?.summary || '').slice(0, 160) || '유튜브 영상 AI 요약 공유'
  const thumb = `https://i.ytimg.com/vi/${data.video.videoId}/hqdefault.jpg`
  return {
    title: `${title} — 요약 | Daily Video Digest`,
    description,
    openGraph: { title, description, images: [thumb], type: 'article' },
    twitter: { card: 'summary_large_image', title, description, images: [thumb] },
  }
}

// ── 공통 스타일 ──────────────────────────────────────────────
const cardStyle: CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 14,
  padding: 18,
}

const sectionLabelStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
  color: 'var(--text-muted)', marginBottom: 10,
}

// 공유자가 강조한 항목(핵심 포인트·요약 문장·타임라인 공통) 하이라이트 스타일
const highlightStyle: CSSProperties = {
  background: 'rgba(255,205,0,0.18)',
  boxShadow: 'inset 2px 0 0 var(--text-primary)',
  borderRadius: 5,
  color: 'var(--text-primary)',
  padding: '6px 8px',
}

// 문제 신고 mailto 링크 (공유 토큰을 제목에 포함)
function ReportLink({ token }: { token: string }) {
  const href = `mailto:support@dailyvideodigest.com?subject=${encodeURIComponent(`[공유 신고] ${token}`)}`
  return (
    <a href={href} style={{ fontSize: 10.5, color: 'var(--text-muted)', textDecoration: 'underline' }}>
      문제 신고
    </a>
  )
}

// 상단 서비스 로고 + 본문 래퍼 (외부인 대상 독립 페이지 — AppHeader 미사용)
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      <header style={{
        borderBottom: '0.5px solid var(--border-light)',
        padding: '14px 20px',
      }}>
        <Link href="/" style={{
          fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none',
        }}>
          Daily Video Digest
        </Link>
      </header>
      <main style={{
        maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {children}
      </main>
    </div>
  )
}

// 하단 가입 CTA
function SignupCta() {
  return (
    <div style={{
      ...cardStyle, textAlign: 'center', padding: 24,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      <Sparkles size={18} style={{ color: 'var(--text-tertiary)' }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
        이런 요약을 매일 아침 받아보세요
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        구독 중인 유튜브 채널의 새 영상을 AI가 요약해서
        <br />
        매일 아침 메일함으로 보내드려요.
      </div>
      <Link href="/" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 4, padding: '10px 22px', borderRadius: 8,
        background: 'var(--accent)', color: 'var(--bg-card)',
        fontSize: 13, fontWeight: 600, textDecoration: 'none',
      }}>
        무료로 시작하기
      </Link>
    </div>
  )
}

// 없음/만료/차단 공통 안내
function NoticePage({
  title, desc, icon, cta = true, reportToken,
}: {
  title: string
  desc: string
  icon?: React.ReactNode
  cta?: boolean
  reportToken?: string
}) {
  return (
    <Shell>
      <div style={{ ...cardStyle, textAlign: 'center', padding: '36px 20px' }}>
        {icon && (
          <div style={{
            marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-tertiary)',
          }}>
            {icon}
          </div>
        )}
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</div>
        {reportToken && (
          <div style={{ marginTop: 14 }}>
            <ReportLink token={reportToken} />
          </div>
        )}
      </div>
      {cta && <SignupCta />}
    </Shell>
  )
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params

  const data = isValidTokenFormat(token)
    ? await getShareByToken(token, {
        countView: !isBotUA((await headers()).get('user-agent') ?? ''),
      })
    : null

  if (!data) {
    return (
      <NoticePage
        title="존재하지 않는 공유입니다"
        desc="링크가 잘못되었거나 삭제된 공유예요."
      />
    )
  }
  if (data.blocked) {
    return (
      <NoticePage
        icon={<ShieldOff size={22} />}
        title="더 이상 볼 수 없는 공유입니다"
        desc="운영 정책에 따라 비공개 처리되었습니다."
        cta={false}
      />
    )
  }
  if (data.expired || !data.video) {
    return (
      <NoticePage
        title="이 공유는 만료되었습니다"
        desc="공유 링크는 생성 후 14일간 유효해요."
        reportToken={token}
      />
    )
  }

  const { video, summary } = data
  const ann = data.annotations

  // 핵심 포인트 강조 인덱스 — text 일치 우선, 없으면 인덱스(i) 폴백.
  const activeKpIdx = new Set<number>()
  if (ann && summary) {
    for (const a of ann.keyPoints) {
      const byText = summary.keyPoints.findIndex(p => p === a.text)
      if (byText >= 0) activeKpIdx.add(byText)
      else if (a.i >= 0 && a.i < summary.keyPoints.length) activeKpIdx.add(a.i)
    }
  }
  // 타임라인 강조 시각 — annotations 있으면 그 time, 없으면(구버전) highlight_time 폴백.
  const activeTlTimes = new Set<string>()
  if (ann) {
    for (const t of ann.timeline) activeTlTimes.add(t.time)
  } else if (data.highlightTime) {
    activeTlTimes.add(data.highlightTime)
  }

  const timelineItems = (summary?.timeline ?? []).map(it => ({
    time: it.time,
    content: it.content,
    seconds: toSeconds(it.time),
    active: activeTlTimes.has(it.time),
  }))
  const watchUrl = `https://youtube.com/watch?v=${video.videoId}`

  return (
    <Shell>
      {/* (a) 공유자 메모 배너 */}
      {data.comment && (
        <div style={{
          ...cardStyle,
          background: 'var(--bg-subtle)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ ...sectionLabelStyle, marginBottom: 0 }}>
            <MessageSquareQuote size={12} />
            {data.sharerName ? `${data.sharerName}님의 메모` : '익명의 메모'}
          </span>
          <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            {data.comment}
          </div>
        </div>
      )}

      {/* (b) 영상 제목 + 채널명 (임베드는 요약 아래로 이동) */}
      <div style={cardStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.45 }}>
          {video.title}
        </div>
        {video.channelName && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {video.channelName}
          </div>
        )}
      </div>

      {summary ? (
        <>
          {/* (c) TL;DR 강조 박스 */}
          {summary.tldr && (
            <div style={{
              ...cardStyle,
              borderLeft: '3px solid var(--accent)',
              fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6,
            }}>
              {summary.tldr}
            </div>
          )}

          {/* 역피라미드(이메일과 통일): tldr → 핵심 포인트 → 임베드 → 타임라인 */}
          {/* 상세 요약은 공유 페이지에서 표시하지 않는다(이메일 전용) — 데이터는 계속 저장됨 */}
          {/* (d) 핵심 포인트 — 불릿 없이 "앵커 — 설명" 한 줄, 앵커만 세미볼드. 강조된 항목만 하이라이트 */}
          {summary.keyPoints.length > 0 && (
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>핵심 포인트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {summary.keyPoints.map((p, i) => {
                  const active = activeKpIdx.has(i)
                  // 새 형식은 상세 요약과 같은 `**앵커.**` 마커 → 볼드 변환만.
                  // 마커가 없는 과거 형식('앵커 — 부연')만 splitKeyPointPrefix로 앞부분을 굵게.
                  const segs = splitBoldSegments(p)
                  const legacy = segs.some(s => s.bold) ? null : splitKeyPointPrefix(p)
                  return (
                    <div key={i} style={{
                      fontSize: 13.5, lineHeight: 1.6,
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      ...(active ? highlightStyle : {}),
                    }}>
                      {legacy?.prefix && (
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                          {legacy.prefix}{' — '}
                        </span>
                      )}
                      {(legacy ? splitBoldSegments(legacy.rest) : segs).map((seg, bi) =>
                        seg.bold
                          ? <strong key={bi} style={{ color: 'var(--text-primary)' }}>{seg.text}</strong>
                          : <span key={bi}>{seg.text}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          이 영상의 요약을 불러올 수 없어요. 아래 영상에서 직접 확인해 주세요.
        </div>
      )}

      {/* (f) 유튜브 임베드 + 타임라인(클릭 시 해당 시각 재생) */}
      <ShareVideo videoId={video.videoId} watchUrl={watchUrl} timeline={timelineItems} />

      {/* (g) 하단 가입 CTA */}
      <SignupCta />

      {/* (h) 푸터 — 문제 신고 */}
      <div style={{ textAlign: 'center', paddingTop: 2 }}>
        <ReportLink token={token} />
      </div>
    </Shell>
  )
}
