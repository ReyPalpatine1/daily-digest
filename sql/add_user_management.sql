-- 사용자 관리 페이지용 컬럼 추가
-- Supabase SQL Editor에서 실행하세요.

-- 관리자 메모
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_note TEXT;

-- 마지막 접속 시각 (대시보드 진입 시 갱신)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
