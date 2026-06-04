-- 채널 활성/비활성 (plan 강등 시 비활성화용)
-- Supabase SQL Editor에서 실행하세요.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(user_id, is_active);

-- 기존 행은 모두 활성으로 보정
UPDATE channels SET is_active = true WHERE is_active IS NULL;
