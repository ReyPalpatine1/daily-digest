import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { MessageSquareQuote, ShieldOff, Sparkles } from 'lucide-react'
import { getShareByToken } from '@/lib/share'
import { splitBoldSegments, splitKeyPointPrefix } from '@/lib/summary-format'
import ShareVideo from '@/components/ShareVideo'
import ScrollTopButton from '@/components/ScrollTopButton'
import ShareReportButton from '@/components/ShareReportButton'

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

// 링크 미리보기(OG/트위터) 문구 한도 — 카카오 피드 카드(ShareSheet)와 같은 값.
// 링크를 그대로 붙여넣었을 때도 카카오 카드와 비슷하게 보이도록 맞춘다.
const CARD_TITLE_MAX = 40
const CARD_DESC_MAX = 60

// 카드 문구 다듬기 — 볼드 마커(**)를 지운 뒤, 상한을 넘으면 상한 이내 마지막 공백에서 자르고
// '…'을 붙인다(공백이 없으면 상한에서 그대로 자름). ShareSheet의 cardText와 동일 규칙.
function cardText(raw: string | null | undefined, max: number): string {
  const s = (raw ?? '').replace(/\*\*/g, '').trim()
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const sp = head.lastIndexOf(' ')
  return `${(sp > 0 ? head.slice(0, sp) : head).trim()}…`
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

  // 미리보기 카드는 카카오 카드와 같은 구성 — 제목=공유자 메모, 설명=tldr.
  // 메모가 없으면 제목 자리에 고정 문구를 넣어 첫 줄이 비지 않게 한다.
  // tldr이 없을 때만 설명을 영상 제목으로 대체하고, 그것도 없으면 설명을 생략한다.
  // 브라우저 탭 제목(title)은 영상 제목 그대로 — 미리보기 제목과 분리한다.
  const cardTitle = cardText(data.comment, CARD_TITLE_MAX) || '📌 핵심 포인트'
  const cardDesc = cardText(data.summary?.tldr, CARD_DESC_MAX) || cardText(title, CARD_DESC_MAX)

  return {
    title: `${title} — 요약 | Daily Video Digest`,
    description,
    openGraph: {
      title: cardTitle,
      ...(cardDesc ? { description: cardDesc } : {}),
      images: [thumb],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: cardTitle,
      ...(cardDesc ? { description: cardDesc } : {}),
      images: [thumb],
    },
  }
}

// ── 공통 스타일 ──────────────────────────────────────────────
const cardStyle: CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 14,
  padding: 18,
}

// 섹션 라벨 — 열람기록(대시보드)과 동일 스타일. 문구도 같은 형태로 맞춘다(서버 컴포넌트라 t() 미사용).
const sectionLabelStyle: CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
  color: 'var(--text-muted)', marginBottom: 9,
}

// 메모 배너 라벨 — 아이콘과 함께 한 줄로.
const bannerLabelStyle: CSSProperties = {
  ...sectionLabelStyle,
  display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 0,
}

// 항목 행 공통 — 강조 여부와 무관하게 같은 여백을 줘 강조가 붙어도 글자가 움직이지 않게 한다.
// 좌우 -9px로 살짝 넓게 칠해 항목 단위임을 드러낸다(공유 시트·타임라인과 동일 규칙).
const rowStyle: CSSProperties = {
  margin: '0 -9px',
  padding: '3px 9px',
  borderRadius: 6,
}

// 공유자가 강조한 항목 하이라이트 — 노란 배경만(세로 바·체크 없음).
const highlightStyle: CSSProperties = {
  background: 'rgba(255,205,0,0.20)',
  color: 'var(--text-primary)',
}

// 문제 신고 — 신고 모달(ReportModal)을 여는 버튼. 상태가 필요해 클라이언트 래퍼로 감싼다.
function ReportLink({ token }: { token: string }) {
  return <ShareReportButton token={token} />
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
// token을 알 수 있으면 어느 공유에서 왔는지까지 남긴다(없으면 ref=share만).
function SignupCta({ token }: { token?: string }) {
  const href = token ? `/?ref=share&t=${encodeURIComponent(token)}` : '/?ref=share'
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
      <Link href={href} style={{
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
  title, desc, icon, cta = true, reportToken, ctaToken,
}: {
  title: string
  desc?: string
  icon?: React.ReactNode
  cta?: boolean
  reportToken?: string
  // 실제로 존재하는 공유일 때만 넘긴다(없는 공유의 토큰은 의미가 없어 ref=share만 붙임).
  ctaToken?: string
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
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: desc ? 8 : 0 }}>
          {title}
        </div>
        {desc && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</div>
        )}
        {reportToken && (
          <div style={{ marginTop: 14 }}>
            <ReportLink token={reportToken} />
          </div>
        )}
      </div>
      {cta && <SignupCta token={ctaToken} />}
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
      <NoticePage title="존재하지 않는 공유입니다." />
    )
  }
  if (data.blocked) {
    return (
      <NoticePage
        icon={<ShieldOff size={22} />}
        title="더 이상 볼 수 없는 공유입니다."
        desc="운영 정책에 따라 비공개 처리되었습니다."
        cta={false}
      />
    )
  }
  if (data.expired || !data.video) {
    return (
      <NoticePage
        title="이 공유는 만료되었습니다."
        desc="공유 링크는 생성 후 14일이 지나면 만료됩니다."
        reportToken={token}
        ctaToken={token}
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
      {/* (1) 공유자 메모 배너 */}
      {data.comment && (
        <div style={{
          ...cardStyle,
          background: 'var(--bg-subtle)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={bannerLabelStyle}>
            <MessageSquareQuote size={12} />
            공유자 메모
          </span>
          <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            {data.comment}
          </div>
        </div>
      )}

      {/* (2)~(4) 요약 카드 하나 — 열람기록과 동일하게 섹션별 박스 없이 여백·라벨로만 구분.
          순서: 임베드 + 타임라인(ShareVideo) → tldr → 핵심 포인트.
          타임라인은 클릭 시 플레이어가 그 시점으로 이동하므로 임베드 바로 아래에 둔다.
          상세 요약은 공유 페이지에서 표시하지 않는다(이메일 전용) — 데이터는 계속 저장됨. */}
      <div style={cardStyle}>
        {/* (2) 임베드 + 제목 캡션 + 타임라인 */}
        <ShareVideo
          videoId={video.videoId}
          videoTitle={video.title}
          watchUrl={watchUrl}
          timeline={timelineItems}
        />

        {/* (3) tldr — 둥근 바 + 본문 (배경 없음) */}
        {summary?.tldr && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
            <div style={{
              width: 3, borderRadius: 2,
              background: 'var(--text-primary)', flexShrink: 0,
            }} />
            <div style={{
              fontSize: 14.5, fontWeight: 600,
              color: 'var(--text-primary)', lineHeight: 1.6,
            }}>
              {summary.tldr}
            </div>
          </div>
        )}

        {/* (4) 핵심 포인트 — 옅은 박스. 강조된 항목만 노란 배경 */}
        {summary && summary.keyPoints.length > 0 && (
          <div style={{
            background: 'var(--bg-subtle)', borderRadius: 8,
            padding: '14px 15px',
          }}>
            <div style={sectionLabelStyle}>📌 핵심 포인트</div>
            {summary.keyPoints.map((p, i) => {
              const active = activeKpIdx.has(i)
              // 새 형식은 상세 요약과 같은 `**앵커.**` 마커 → 볼드 변환만.
              // 마커가 없는 과거 형식('앵커 — 부연')만 splitKeyPointPrefix로 앞부분을 굵게.
              const segs = splitBoldSegments(p)
              const legacy = segs.some(s => s.bold) ? null : splitKeyPointPrefix(p)
              return (
                <div key={i} style={{
                  fontSize: 13, lineHeight: 1.6,
                  color: 'var(--text-secondary)',
                  ...rowStyle,
                  ...(active ? highlightStyle : {}),
                  marginBottom: 5,
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
        )}

        {!summary && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            이 영상의 요약을 불러올 수 없어요. 위 영상에서 직접 확인해 주세요.
          </div>
        )}
      </div>

      {/* (5) 하단 가입 CTA */}
      <SignupCta token={token} />

      {/* (6) 푸터 — 만료 안내(좌) + 문제 신고(우) 한 줄. 좁은 화면에선 줄바꿈 */}
      <div style={{
        paddingTop: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          이 링크는 14일 후 만료됩니다.
        </span>
        <ReportLink token={token} />
      </div>

      {/* 맨 위로 — 열람기록과 동일한 공용 버튼 */}
      <ScrollTopButton label="맨 위로" />
    </Shell>
  )
}
