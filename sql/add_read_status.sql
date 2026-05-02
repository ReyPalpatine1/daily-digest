-- digests 테이블에 읽음 여부 컬럼 추가
ALTER TABLE digests ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

-- 인덱스 추가 (배지 카운트 쿼리 성능)
CREATE INDEX IF NOT EXISTS idx_digests_user_breaking_read
ON digests(user_id, is_breaking, is_read)
WHERE is_breaking = true;
