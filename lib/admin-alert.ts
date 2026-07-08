// 관리자 오류 알림 디스패처 — admin_alert_settings(전역 단일 행)에 따라
// 이메일(기존 포맷 유지) / 텔레그램(간단 요약) 발송을 분기한다.
// 알림 실패가 주 흐름을 막지 않도록 모든 경로 try-catch.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { createClient } from '@supabase/supabase-js'
import { sendAdminBulkErrorEmail, sendAdminFeedbackEmail, type FailedItem, type DigestTrigger } from './mailer'
import { sendTelegramMessage } from './telegram'

// Cloudflare Workers 호환: process.env는 요청 처리 시점에 채워지므로 lazy 생성.
function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
}
type ServiceClient = ReturnType<typeof makeServiceClient>
let _supabase: ServiceClient | null = null
function getSupabase(): ServiceClient {
  if (!_supabase) _supabase = makeServiceClient()
  return _supabase
}

export type AdminAlertSettings = { notify_email: boolean; notify_telegram: boolean }

// 알림 설정 조회 — 행/테이블이 없거나 조회 실패 시 기본값(이메일 on / 텔레그램 off)으로
// 기존 동작(이메일 보고)을 유지한다.
export async function getAdminAlertSettings(): Promise<AdminAlertSettings> {
  try {
    const { data } = await getSupabase()
      .from('admin_alert_settings')
      .select('notify_email, notify_telegram')
      .maybeSingle()
    if (data) {
      return {
        notify_email: (data as any).notify_email !== false,
        notify_telegram: (data as any).notify_telegram === true,
      }
    }
  } catch (e) {
    console.error('[admin-alert] 설정 조회 실패:', e)
  }
  return { notify_email: true, notify_telegram: false }
}

// 관리자 텔레그램 chat_id 조회: ADMIN_EMAILS → profiles → settings.telegram_chat_id.
// 여러 관리자 중 첫 번째로 연결된 chat_id를 사용. 없으면 null.
export async function findAdminTelegramChatId(): Promise<string | null> {
  try {
    // env는 함수 내부에서 읽는다 (Cloudflare 호환)
    const adminEmails = (process.env.ADMIN_EMAILS ?? '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    if (!adminEmails.length) return null

    const supabase = getSupabase()
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('email', adminEmails)
    const ids = (profiles ?? []).map(p => (p as any).id).filter(Boolean)
    if (!ids.length) return null

    const { data: settings } = await supabase
      .from('settings')
      .select('user_id, telegram_chat_id')
      .in('user_id', ids)
    for (const s of settings ?? []) {
      const chatId = (s as any).telegram_chat_id
      if (chatId) return String(chatId)
    }
    return null
  } catch (e) {
    console.error('[admin-alert] 관리자 chat_id 조회 실패:', e)
    return null
  }
}

// 텔레그램 parse_mode=HTML 본문 이스케이프
function escapeTg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 관리자 실패 알림 — 설정에 따라 이메일/텔레그램(중복 가능) 발송. 둘 다 꺼져 있으면 적재만.
// 어떤 실패도 throw하지 않는다 (발송 주 흐름 보호).
export async function sendAdminFailureAlert(
  userName: string,
  userEmail: string,
  userId: string,
  failedItems: FailedItem[],
  trigger: DigestTrigger
): Promise<void> {
  try {
    if (!failedItems.length) return
    const alertSettings = await getAdminAlertSettings()
    if (!alertSettings.notify_email && !alertSettings.notify_telegram) {
      console.log('[admin-alert] 이메일/텔레그램 알림 모두 꺼짐 → 발송 생략 (error_log 적재만)')
      return
    }

    if (alertSettings.notify_email) {
      try {
        await sendAdminBulkErrorEmail(userName, userEmail, userId, failedItems, trigger)
      } catch (e) {
        console.error('[admin-alert] 관리자 이메일 알림 실패:', e)
      }
    }

    if (alertSettings.notify_telegram) {
      try {
        const chatId = await findAdminTelegramChatId()
        if (!chatId) {
          console.log('[admin-alert] 관리자 telegram_chat_id 미연결 → 텔레그램 알림 skip')
          return
        }
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
        const lines: string[] = [`⚠️ 요약 실패 ${failedItems.length}건`]
        for (const item of failedItems.slice(0, 5)) {
          lines.push(escapeTg(`- ${item.videoTitle} (${item.reason ?? item.errorInfo.split('\n')[0]})`))
        }
        if (failedItems.length > 5) lines.push(escapeTg(`… 외 ${failedItems.length - 5}건`))
        lines.push(appUrl ? `관리자 페이지에서 전체 확인: ${appUrl}/admin/errors` : '관리자 페이지에서 전체 확인')
        await sendTelegramMessage(chatId, lines.join('\n'))
      } catch (e) {
        console.error('[admin-alert] 관리자 텔레그램 알림 실패:', e)
      }
    }
  } catch (e) {
    console.error('[admin-alert] 알림 처리 예외:', e)
  }
}

export type FeedbackAlert = {
  userEmail: string
  rating: number | null
  type: string
  message: string
}

// 관리자 피드백 알림 — 설정에 따라 이메일/텔레그램(중복 가능) 발송. 둘 다 꺼져 있으면 발송 생략.
// 어떤 실패도 throw하지 않는다 (제출 주 흐름 보호).
export async function sendAdminFeedbackAlert(feedback: FeedbackAlert): Promise<void> {
  try {
    const alertSettings = await getAdminAlertSettings()
    if (!alertSettings.notify_email && !alertSettings.notify_telegram) {
      console.log('[admin-alert] 이메일/텔레그램 알림 모두 꺼짐 → 피드백 알림 발송 생략')
      return
    }

    if (alertSettings.notify_email) {
      try {
        await sendAdminFeedbackEmail(feedback)
      } catch (e) {
        console.error('[admin-alert] 피드백 이메일 알림 실패:', e)
      }
    }

    if (alertSettings.notify_telegram) {
      try {
        const chatId = await findAdminTelegramChatId()
        if (!chatId) {
          console.log('[admin-alert] 관리자 telegram_chat_id 미연결 → 피드백 텔레그램 알림 skip')
          return
        }
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
        const ratingLabel = feedback.rating ? `${feedback.rating}★` : '-'
        const preview = feedback.message.length > 300 ? feedback.message.slice(0, 300) + '…' : feedback.message
        const lines: string[] = [
          '💬 새 피드백이 도착했습니다',
          escapeTg(`유형: ${feedback.type} · 별점: ${ratingLabel}`),
          escapeTg(`작성자: ${feedback.userEmail || '(알 수 없음)'}`),
          escapeTg(preview),
        ]
        lines.push(appUrl ? `관리자 페이지에서 확인: ${appUrl}/admin/feedback` : '관리자 페이지에서 확인')
        await sendTelegramMessage(chatId, lines.join('\n'))
      } catch (e) {
        console.error('[admin-alert] 피드백 텔레그램 알림 실패:', e)
      }
    }
  } catch (e) {
    console.error('[admin-alert] 피드백 알림 처리 예외:', e)
  }
}
