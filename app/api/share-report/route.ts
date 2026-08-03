import { NextResponse } from 'next/server'
import {
  createShareReport,
  fetchShareReportContext,
  SHARE_REPORT_REASON_LABEL,
  type ShareReportReason,
} from '@/lib/share-report'
import { sendAdminShareReportAlert } from '@/lib/admin-alert'
import { isValidTokenFormat } from '@/lib/share'
import { hashVisitor, resolveClientIp } from '@/lib/visit-guard'

// 공유 페이지 문제 신고 — 로그인 불필요(외부인이 보는 공개 페이지에서 신고하므로).
// POST만 export → 다른 메서드는 Next.js가 405로 응답한다.

const ALLOWED_REASONS: ShareReportReason[] = ['abuse', 'privacy', 'other']

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    token?: string
    reason?: string
    detail?: string
  }

  // token: 필수
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token || !isValidTokenFormat(token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  }

  // reason: 화이트리스트 외 값은 400 (피드백과 달리 임의 폴백 없음 — 신고 사유는 근거가 되므로)
  if (!ALLOWED_REASONS.includes(body.reason as ShareReportReason)) {
    return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })
  }
  const reason = body.reason as ShareReportReason

  // 신고자 식별용 해시 — 원본 IP는 저장하지 않는다(해시 알고리즘은 lib/visit-guard.ts 공용).
  const reporterHash = await hashVisitor(resolveClientIp(req))

  const result = await createShareReport({
    token,
    reason,
    detail: typeof body.detail === 'string' ? body.detail : undefined,
    reporterHash,
  })

  // 도배 차단·저장 실패도 사용자에겐 성공처럼 보이게 한다(신고 접수 여부를 탐지하지 못하도록).
  // 서버 로그에는 남겨 운영 중 확인할 수 있게 한다.
  if (!result.ok) {
    console.log(`[share-report] 신고 미접수(token=${token}, reason=${result.reason})`)
    return NextResponse.json({ ok: true })
  }

  // 관리자 알림은 실패해도 신고 접수(이미 저장 완료)를 막지 않는다.
  try {
    const context = await fetchShareReportContext(token)
    await sendAdminShareReportAlert({
      token,
      reasonLabel: SHARE_REPORT_REASON_LABEL[reason],
      detail: body.detail?.trim() ? body.detail.trim().slice(0, 300) : null,
      sharedBy: context.sharedBy,
      commentSnapshot: context.commentSnapshot,
      videoTitle: context.videoTitle,
    })
  } catch (e) {
    console.error('[share-report] 관리자 알림 발송 실패:', e)
  }

  return NextResponse.json({ ok: true })
}
