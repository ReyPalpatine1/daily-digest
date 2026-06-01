-- 사용자 플랜 시스템 + VIP 관리
-- Supabase SQL Editor에서 실행하세요.

-- profiles 테이블에 플랜 관련 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vip_granted_by TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vip_granted_at TIMESTAMPTZ;

-- 기존 사용자는 모두 free (CHECK 제약 추가 전에 NULL 정리)
UPDATE profiles SET plan = 'free' WHERE plan IS NULL;

-- plan 값 제약: free, pro, vip (재실행 안전하게 기존 제약 먼저 제거)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS plan_check;
ALTER TABLE profiles ADD CONSTRAINT plan_check
  CHECK (plan IN ('free', 'pro', 'vip'));

-- 플랜별 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_plan ON profiles(plan);
