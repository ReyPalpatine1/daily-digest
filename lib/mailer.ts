import nodemailer from 'nodemailer'
import { SummaryResult } from './gemini'
import { VideoItem } from './youtube'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

type DigestItem = {
  channel: string
  category: string
  emoji: string
  video: VideoItem
  summary: SummaryResult
}

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildEmailHtml(items: DigestItem[], userName: string): string {
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const grouped: Record<string, DigestItem[]> = {}
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  })

  const categorySections = Object.entries(grouped).map(([cat, catItems]) => `
    <div style="margin-bottom:32px">
      <h2 style="font-size:18px;color:#1a1a1a;border-bottom:2px solid #e8ff47;padding-bottom:8px;margin-bottom:16px">
        ${cat}
      </h2>
      ${catItems.map(item => `
        <div style="background:#f9f9f9;border-radius:12px;padding:20px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:20px">${item.emoji}</span>
            <span style="font-size:13px;color:#666">${item.channel}</span>
          </div>
          <h3 style="font-size:16px;margin:0 0 4px">
            <a href="${item.video.url}" style="color:#1a1a1a;text-decoration:none">
              ${item.video.title}
            </a>
          </h3>
          <div style="font-size:12px;color:#999;margin-bottom:12px">
            🕐 ${formatTime(item.video.publishedAt)} 업로드
          </div>
          <div style="font-size:11px;color:#999;margin-bottom:6px">
            📌 ${item.summary.summaryBasis ?? '요약'}
          </div>
          <p style="font-size:14px;color:#333;line-height:1.7;margin:0 0 12px">
            ${item.summary.summary}
          </p>
          ${item.summary.keyPoints.length > 0 ? `
            <div style="margin-bottom:12px">
              <div style="font-size:12px;font-weight:600;color:#666;margin-bottom:6px">핵심 포인트</div>
              <ul style="margin:0;padding-left:16px">
                ${item.summary.keyPoints.map(p =>
                  `<li style="font-size:13px;color:#333;margin-bottom:4px">${p}</li>`
                ).join('')}
              </ul>
            </div>
          ` : ''}
          ${item.summary.timeline.length > 0 ? `
            <div>
              <div style="font-size:12px;font-weight:600;color:#666;margin-bottom:6px">타임라인</div>
              ${item.summary.timeline.map(t => `
                <div style="font-size:12px;color:#555;margin-bottom:4px">
                  <span style="background:#e8ff47;color:#000;padding:1px 6px;border-radius:4px;margin-right:6px">${t.time}</span>
                  ${t.content}
                </div>
              `).join('')}
            </div>
          ` : ''}
          <div style="margin-top:12px">
            <a href="${item.video.url}"
              style="background:#ff0000;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px">
              ▶ 영상 보기
            </a>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('')

  return `
    <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <div style="background:#0a0a0a;padding:24px;border-radius:12px;margin-bottom:24px">
        <h1 style="font-size:28px;color:#e8ff47;margin:0;letter-spacing:2px">DAILY DIGEST</h1>
        <p style="color:#888;margin:4px 0 0;font-size:14px">${today} · ${userName}님의 유튜브 요약</p>
      </div>
      ${categorySections}
      <div style="text-align:center;font-size:12px;color:#999;margin-top:32px">
        Daily Digest AI 에이전트가 자동으로 생성했습니다
      </div>
    </div>
  `
}

export async function sendDigestEmail(
  to: string,
  userName: string,
  items: DigestItem[]
): Promise<void> {
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
  })

  await transporter.sendMail({
    from: `"Daily Digest" <${process.env.GMAIL_USER}>`,
    to,
    subject: `📺 ${today} Daily Digest — ${items.length}개 영상 요약`,
    html: buildEmailHtml(items, userName),
  })
}

export async function sendBreakingAlert(
  to: string,
  userName: string,
  item: DigestItem
): Promise<void> {
  await transporter.sendMail({
    from: `"Daily Digest 속보" <${process.env.GMAIL_USER}>`,
    to,
    subject: `🚨 속보 감지 — ${item.video.title}`,
    html: buildEmailHtml([item], userName),
  })
}