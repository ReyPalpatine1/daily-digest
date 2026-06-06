-- 새 영상이 없는 날에도 "영상 없음" 안내 메일을 받을지 여부 (기본 켜짐)
-- Supabase SQL Editor에서 실행하세요.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS notify_when_empty BOOLEAN DEFAULT true;
