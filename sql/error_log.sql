-- 관리자 오류 시스템: 오류 적재 테이블 + 알림 설정(단일 행).
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것)

-- 1) 오류 적재 테이블
CREATE TABLE IF NOT EXISTS error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,          -- 'summary' | 'digest' | 'breaking' | 'collect' 등 발생 지점
  video_id text,
  video_title text,
  channel_name text,
  fail_reason text,              -- no_source | temporary | live | send_error 등
  fail_detail text
);
CREATE INDEX IF NOT EXISTS idx_error_log_occurred_at ON error_log(occurred_at DESC);

-- 2) 관리자 알림 설정 (전역 단일 행)
CREATE TABLE IF NOT EXISTS admin_alert_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), -- 단일 행 보장
  notify_email boolean NOT NULL DEFAULT true,
  notify_telegram boolean NOT NULL DEFAULT false
);
INSERT INTO admin_alert_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- 3) 30일 초과분 정리는 digest 발송의 기존 30일 정리 지점(delete_old_digests 호출부)에서
--    코드로 함께 수행한다 (lib/error-log.ts cleanupOldErrorLogs).
