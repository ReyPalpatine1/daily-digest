import { NextResponse } from 'next/server'
import { runCollection } from '@/lib/video-pool'
import { nowUtc, toZoned } from '@/lib/time'
import { sendAdminNewErrorsAlert } from '@/lib/admin-alert'

export const maxDuration = 60

// 공유 영상 수집 엔드포인트 (발송과 분리된 별도 주기로 호출).
// 4b단계: 고유 채널 조회 → videos 적재 → 미요약 영상 요약(영상당 1번).
// ⚠️ 아직 발송에 연결되지 않음. 발송 전환은 4c.
export async function GET(req: Request) {
  try {
    const now = nowUtc()
    const z = toZoned(now)
    console.log(`🛰 [collect] 진입 UTC=${now.toISOString()} KST=${z.hour}:${String(z.minute).padStart(2, '0')}`)

    // cron 인증 (정각 cron과 동일한 CRON_SECRET)
    const authHeader = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET}`
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      console.warn(`🚫 [collect] 인증 실패 → 401`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 지난 알림 이후 쌓인 오류를 run 시작 전에 먼저 알림 (run이 CPU 한도로 죽어도 이전 오류 알림은 보존)
    try { await sendAdminNewErrorsAlert(now.toISOString()) } catch (e) { console.error('[collect] 신규 오류 알림 실패(무시):', e) }
    const result = await runCollection()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[collect] error:', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
