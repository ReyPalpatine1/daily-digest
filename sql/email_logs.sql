-- 이메일 발송 로그 (발송 성공률 집계용)
-- Supabase SQL Editor에서 실행하세요.

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  email TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'digest', 'breaking', 'error', 'welcome'
  status TEXT NOT NULL,          -- 'success', 'failed'
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent ON email_logs(sent_at);
