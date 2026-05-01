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

function truncateErrorInfo(errorInfo?: string): string | undefined {
  if (!errorInfo) return undefined
  const firstLine = errorInfo.trim().split('\n')[0]
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine
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
          ${item.summary.errorInfo ? `
            <div style="font-size:12px;color:#b00;margin-bottom:10px;line-height:1.4">
              <strong>오류 코드:</strong> ${truncateErrorInfo(item.summary.errorInfo)}
            </div>
          ` : ''}
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

type FailedItem = {
  channel: string
  category: string
  emoji: string
  videoTitle: string
  videoUrl: string
  errorInfo: string
}

export async function sendAdminBulkErrorEmail(
  to: string,
  userName: string,
  userEmail: string,
  userId: string,
  failedItems: FailedItem[]
): Promise<void> {
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
  })

  const errorTable = failedItems.map((item, idx) => `
    <tr style="border-bottom:1px solid #ddd">
      <td style="padding:12px;text-align:center;font-size:13px">${idx + 1}</td>
      <td style="padding:12px;font-size:13px">${item.emoji} ${item.channel}</td>
      <td style="padding:12px;font-size:13px">${item.category}</td>
      <td style="padding:12px;font-size:12px"><a href="${item.videoUrl}" style="color:#1a1a1a;text-decoration:none">${item.videoTitle}</a></td>
      <td style="padding:12px;font-size:12px;color:#b00000">${item.errorInfo.split('\n')[0]}</td>
    </tr>
  `).join('')

  await transporter.sendMail({
    from: `"Daily Digest 오류 알림" <${process.env.GMAIL_USER}>`,
    to,
    subject: `❗ Daily Digest 오류 알림 — ${failedItems.length}개 영상 실패`,
    html: `
      <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:1000px;margin:0 auto;padding:24px">
        <div style="background:#fff7f7;border:1px solid #ff4757;border-radius:12px;padding:24px;margin-bottom:24px">
          <h1 style="font-size:22px;color:#b00000;margin:0 0 12px">Daily Digest 관리자 오류 알림</h1>
          <div style="font-size:14px;color:#333;line-height:1.6;margin-bottom:20px">
            <p>발송일: ${today}</p>
            <p>사용자: ${userName}</p>
            <p>사용자 이메일: ${userEmail}</p>
            <p>사용자 ID: ${userId}</p>
            <p style="font-weight:600;color:#b00000">오류 발생 영상: <strong>${failedItems.length}개</strong></p>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f5f5f5;border-bottom:2px solid #ddd">
                <th style="padding:12px;text-align:center;font-size:13px;font-weight:600">#</th>
                <th style="padding:12px;font-size:13px;font-weight:600">채널</th>
                <th style="padding:12px;font-size:13px;font-weight:600">카테고리</th>
                <th style="padding:12px;font-size:13px;font-weight:600">영상 제목</th>
                <th style="padding:12px;font-size:13px;font-weight:600">오류</th>
              </tr>
            </thead>
            <tbody>
              ${errorTable}
            </tbody>
          </table>
          <div style="margin-top:20px;font-size:12px;color:#666">
            <p>자세한 오류 정보는 Vercel 로그를 참조하세요.</p>
          </div>
        </div>
      </div>
    `,
  })
}
