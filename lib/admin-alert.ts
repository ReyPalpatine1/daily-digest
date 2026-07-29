// 관리자 오류 알림 디스패처 — admin_alert_settings(전역 단일 행)에 따라
// 이메일(기존 포맷 유지) / 텔레그램(간단 요약) 발송을 분기한다.
// 알림 실패가 주 흐름을 막지 않도록 모든 경로 try-catch.
// ⚠️ SUPABASE_SERVICE_KEY 사용 → 서버에서만 import.
import { createClient } from '@supabase/supabase-js'
import { sendAdminBulkErrorEmail, sendAdminFeedbackEmail, sendAdminNewErrorsEmail, sendAdminShareReportEmail, type FailedItem, type DigestTrigger } from './mailer'
import { sendTelegramMessage } from './telegram'
import { nowUtc } from './time'

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

export type AdminAlertSettings = {
  notify_email: boolean
  notify_telegram: boolean
  last_error_alert_at: string | null // 신규 오류 집계 워터마크 (마지막 알림 시각)
}

// 알림 설정 조회 — 행/테이블이 없거나 조회 실패 시 기본값(이메일 on / 텔레그램 off)으로
// 기존 동작(이메일 보고)을 유지한다.
export async function getAdminAlertSettings(): Promise<AdminAlertSettings> {
  try {
    const { data } = await getSupabase()
      .from('admin_alert_settings')
      .select('notify_email, notify_telegram, last_error_alert_at')
      .maybeSingle()
    if (data) {
      return {
        notify_email: (data as any).notify_email !== false,
        notify_telegram: (data as any).notify_telegram === true,
        last_error_alert_at: (data as any).last_error_alert_at ?? null,
      }
    }
  } catch (e) {
    console.error('[admin-alert] 설정 조회 실패:', e)
  }
  return { notify_email: true, notify_telegram: false, last_error_alert_at: null }
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

export type ShareReportAlert = {
  token: string
  reasonLabel: string
  detail: string | null
  sharedBy: string | null
  commentSnapshot: string | null
  videoTitle: string | null
}

// 관리자 공유 신고 알림 — 설정에 따라 이메일/텔레그램(중복 가능) 발송. 둘 다 꺼져 있으면 발송 생략.
// 어떤 실패도 throw하지 않는다 (신고 접수 주 흐름 보호).
export async function sendAdminShareReportAlert(report: ShareReportAlert): Promise<void> {
  try {
    const alertSettings = await getAdminAlertSettings()
    if (!alertSettings.notify_email && !alertSettings.notify_telegram) {
      console.log('[admin-alert] 이메일/텔레그램 알림 모두 꺼짐 → 공유 신고 알림 발송 생략')
      return
    }

    if (alertSettings.notify_email) {
      try {
        await sendAdminShareReportEmail(report)
      } catch (e) {
        console.error('[admin-alert] 공유 신고 이메일 알림 실패:', e)
      }
    }

    if (alertSettings.notify_telegram) {
      try {
        const chatId = await findAdminTelegramChatId()
        if (!chatId) {
          console.log('[admin-alert] 관리자 telegram_chat_id 미연결 → 공유 신고 텔레그램 알림 skip')
          return
        }
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
        const lines: string[] = [
          '🚨 공유 페이지 신고가 접수되었습니다',
          escapeTg(`사유: ${report.reasonLabel}`),
          escapeTg(`영상: ${report.videoTitle ?? '(알 수 없음)'}`),
          escapeTg(`상세: ${report.detail ?? '(없음)'}`),
          escapeTg(`공유자 메모: ${report.commentSnapshot ?? '(없음)'}`),
          escapeTg(`공유자 ID: ${report.sharedBy ?? '(알 수 없음)'}`),
          escapeTg(`토큰: ${report.token}`),
        ]
        lines.push(appUrl ? `공유 페이지 확인: ${appUrl}/s/${report.token}` : '공유 페이지 확인')
        await sendTelegramMessage(chatId, lines.join('\n'))
      } catch (e) {
        console.error('[admin-alert] 공유 신고 텔레그램 알림 실패:', e)
      }
    }
  } catch (e) {
    console.error('[admin-alert] 공유 신고 알림 처리 예외:', e)
  }
}

// 신규 오류 집계 알림 — 마지막 알림 시각(admin_alert_settings.last_error_alert_at 워터마크) 이후
// error_log에 쌓인 오류 수를 세어 1회만 알린다(도배 방지). 워터마크가 없으면 fallbackSinceIso
// (호출 시각)를 기준으로 삼아 과거 오류 폭탄을 방지한다.
// collect 라우트에서 run 시작 "전"에 호출 → run이 도중에 죽어도 이전 run의 오류 알림이 유실되지 않는다.
// 어떤 실패도 throw하지 않는다.
export async function sendAdminNewErrorsAlert(fallbackSinceIso: string): Promise<void> {
  try {
    const alertSettings = await getAdminAlertSettings()
    const sinceIso = alertSettings.last_error_alert_at ?? fallbackSinceIso

    const { count, error } = await getSupabase()
      .from('error_log')
      .select('*', { count: 'exact', head: true })
      .gt('occurred_at', sinceIso)
    if (error) {
      console.error('[admin-alert] 신규 오류 카운트 조회 실패:', error.message)
      return
    }
    // 새 오류 없으면 무음. 워터마크도 갱신하지 않음(불필요한 쓰기 방지, 과거 기준 유지 무해)
    if (!count) return

    // 둘 다 꺼져 있으면 발송·워터마크 갱신 모두 생략 → 켜는 순간부터 밀린 오류가 집계됨
    if (!alertSettings.notify_email && !alertSettings.notify_telegram) {
      console.log('[admin-alert] 이메일/텔레그램 알림 모두 꺼짐 → 신규 오류 알림 발송 생략')
      return
    }

    if (alertSettings.notify_email) {
      try {
        await sendAdminNewErrorsEmail(count)
      } catch (e) {
        console.error('[admin-alert] 신규 오류 이메일 알림 실패:', e)
      }
    }

    if (alertSettings.notify_telegram) {
      try {
        const chatId = await findAdminTelegramChatId()
        if (chatId) {
          const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
          const lines: string[] = [escapeTg(`⚠️ 새 오류 ${count}건`)]
          lines.push(appUrl ? `관리자 오류 페이지 확인: ${appUrl}/admin/errors` : '관리자 오류 페이지 확인')
          await sendTelegramMessage(chatId, lines.join('\n'))
        } else {
          console.log('[admin-alert] 관리자 telegram_chat_id 미연결 → 신규 오류 텔레그램 알림 skip')
        }
      } catch (e) {
        console.error('[admin-alert] 신규 오류 텔레그램 알림 실패:', e)
      }
    }

    // 발송 시도 후 워터마크 갱신 (성공 여부와 무관 — 같은 오류 반복 알림 루프 방지)
    const { error: updateError } = await getSupabase()
      .from('admin_alert_settings')
      .update({ last_error_alert_at: nowUtc().toISOString() })
      .eq('id', true)
    if (updateError) {
      console.error('[admin-alert] 신규 오류 워터마크 갱신 실패:', updateError.message)
    }
  } catch (e) {
    console.error('[admin-alert] 신규 오류 알림 처리 예외:', e)
  }
}
