-- Gemini 결제 오류(선불 잔액 소진 등) 관리자 알림 24시간 1회 제한용 워터마크.
-- lib/admin-alert.ts sendAdminGeminiBillingAlert가 이 컬럼을 조건부 UPDATE로 선점한다.
-- 컬럼이 없으면 알림이 발송되지 않으므로(도배 방지) 코드 배포 전후 Supabase SQL Editor에서 실행하세요.
ALTER TABLE admin_alert_settings
  ADD COLUMN IF NOT EXISTS last_gemini_billing_alert_at timestamptz;
