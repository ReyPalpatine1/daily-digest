-- 같은 (user_id, video_id) 가 중복 저장되지 않도록 UNIQUE 제약 추가.
-- 수동 발송("지금 실행하기") 시 upsert로 덮어쓰기 위해 필요.

-- 1) 기존 중복 행 정리 — 각 (user_id, video_id) 그룹에서 가장 최근(created_at DESC) 한 행만 남김
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, video_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM digests
)
DELETE FROM digests
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) UNIQUE 제약 추가 (이미 존재하면 통과)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'digests_user_id_video_id_key'
  ) THEN
    ALTER TABLE digests
      ADD CONSTRAINT digests_user_id_video_id_key UNIQUE (user_id, video_id);
  END IF;
END $$;
