-- 4d (선택): key_points/timeline이 배열이 아닌 형태로 저장된 행 정리.
-- 렌더 단계 safeArray가 이미 방어 중이라 급하진 않음. 저장 데이터까지 깔끔히 하려면 실행.
-- Supabase SQL Editor에서 실행하세요.

-- 1) 깨진 행 확인 (배열이 아닌 것)
SELECT video_id,
       jsonb_typeof(key_points) AS kp_type,
       jsonb_typeof(timeline)   AS tl_type
FROM video_summaries
WHERE jsonb_typeof(key_points) <> 'array'
   OR jsonb_typeof(timeline)   <> 'array';

-- 2-A) 정규화: 배열이 아니면 빈 배열로 (내용은 잃지만 안전)
UPDATE video_summaries
SET key_points = '[]'::jsonb
WHERE jsonb_typeof(key_points) <> 'array';

UPDATE video_summaries
SET timeline = '[]'::jsonb
WHERE jsonb_typeof(timeline) <> 'array';

-- 2-B) (대안) 내용 복구가 필요하면, 최근(어제/당일) 깨진 행만 삭제해 재요약 유도:
--      삭제 후 다음 /api/collect가 미요약으로 보고 다시 요약함 (최근 2일 이내만 대상).
-- DELETE FROM video_summaries
-- WHERE (jsonb_typeof(key_points) <> 'array' OR jsonb_typeof(timeline) <> 'array')
--   AND video_id IN (SELECT video_id FROM videos WHERE published_at >= now() - interval '2 days');
