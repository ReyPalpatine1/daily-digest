import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { Clock, ExternalLink, MessageSquareQuote, Sparkles } from 'lucide-react'
import { getShareByToken } from '@/lib/share'
import { parseSummaryBlocks } from '@/lib/summary-format'

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
  if (!data || data.expired || !data.video) return fallback

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
  fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
  color: 'var(--text-tertiary)', marginBottom: 10,
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

// 없음/만료 공통 안내
function NoticePage({ title, desc }: { title: string; desc: string }) {
  return (
    <Shell>
      <div style={{ ...cardStyle, textAlign: 'center', padding: '36px 20px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</div>
      </div>
      <SignupCta />
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
  if (data.expired || !data.video) {
    return (
      <NoticePage
        title="이 공유는 만료되었습니다"
        desc="공유 링크는 생성 후 14일간 유효해요."
      />
    )
  }

  const { video, summary } = data
  const watchUrl = (t?: string) =>
    `https://youtube.com/watch?v=${video.videoId}${t ? `&t=${toSeconds(t)}s` : ''}`

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

      {/* (b) 영상 제목 + 채널명 + 썸네일 */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <a href={watchUrl(data.highlightTime ?? undefined)} target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', textDecoration: 'none' }}>
          {/* 외부(i.ytimg.com) 이미지 — next/image 원격 도메인 설정 없이 plain img 사용 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
            alt={video.title}
            style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }}
          />
        </a>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {video.title}
          </div>
          <div style={{
            marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            fontSize: 12, color: 'var(--text-tertiary)',
          }}>
            {video.channelName && <span>{video.channelName}</span>}
            <a href={watchUrl()} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              color: 'var(--text-tertiary)', textDecoration: 'none',
            }}>
              <ExternalLink size={11} /> 유튜브에서 보기
            </a>
          </div>
        </div>
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

          {/* 역피라미드(이메일과 통일): tldr → 핵심 포인트 → 상세 요약 → 타임라인 */}
          {/* (d) 핵심 포인트 */}
          {summary.keyPoints.length > 0 && (
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>핵심 포인트</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {summary.keyPoints.map((p, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* (e) 상세 요약 본문 */}
          {summary.summary && (
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>상세 요약</div>
              {/* 마커('## ' 소제목, 빈 줄 문단) 해석 — 마커 없는 기존 데이터는 문단 1개 */}
              <div style={{
                fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.75,
                wordBreak: 'break-word',
              }}>
                {parseSummaryBlocks(summary.summary).map((b, i) =>
                  b.type === 'heading' ? (
                    <div key={i} style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                      marginTop: i === 0 ? 0 : 10, marginBottom: 4,
                    }}>
                      {b.text}
                    </div>
                  ) : (
                    <div key={i} style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{b.text}</div>
                  )
                )}
              </div>
            </div>
          )}

          {/* (f) 타임라인 — highlight_time 일치 항목은 형광펜 강조, 각 항목은 해당 시각 유튜브 링크 */}
          {summary.timeline.length > 0 && (
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>
                <Clock size={12} /> 타임라인
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {summary.timeline.map((item, i) => {
                  const active = data.highlightTime !== null && item.time === data.highlightTime
                  return (
                    <a
                      key={i}
                      href={watchUrl(item.time)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '7px 10px', borderRadius: 6, textDecoration: 'none',
                        background: active ? 'rgba(255,205,0,0.18)' : 'transparent',
                        boxShadow: active ? 'inset 2px 0 0 var(--text-primary)' : 'none',
                      }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 34,
                        fontVariantNumeric: 'tabular-nums',
                        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      }}>
                        {item.time}
                      </span>
                      <span style={{
                        fontSize: 13, lineHeight: 1.55,
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: active ? 600 : 400,
                      }}>
                        {item.content}
                        {active && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
                            ← 공유자가 추천한 구간
                          </span>
                        )}
                      </span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          이 영상의 요약을 불러올 수 없어요. 유튜브에서 영상을 직접 확인해 주세요.
        </div>
      )}

      {/* (g) 하단 가입 CTA */}
      <SignupCta />
    </Shell>
  )
}
