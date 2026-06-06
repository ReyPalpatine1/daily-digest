-- 발송 상태 로그 (정각 발송 멱등성 + 3단계 상태)
-- Supabase SQL Editor에서 실행하세요.

CREATE TABLE IF NOT EXISTS send_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL,                       -- 'scheduled' | 'breaking' | 'manual'
  send_date DATE,                           -- 정각용 (KST 날짜, dateKey)
  video_id TEXT,                            -- 속보용
  status TEXT NOT NULL DEFAULT 'sending',   -- 'sending' | 'sent' | 'failed'
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 정각: user당 날짜당 1회 (manual 제외) — 동시성/중복 방어의 핵심
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_log_scheduled
  ON send_log(user_id, send_date)
  WHERE type = 'scheduled';

-- 속보: user당 video당 1회 (다음 단계에서 사용)
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_log_breaking
  ON send_log(user_id, video_id)
  WHERE type = 'breaking';

-- 죽은(sending) 프로세스 탐색용
CREATE INDEX IF NOT EXISTS idx_send_log_status ON send_log(status, started_at);
