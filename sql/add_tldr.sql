-- 한 줄 요약(tldr) 컬럼 추가: 요약 품질 평가용 (생성·저장만, UI 미노출).
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것 —
-- 컬럼이 없으면 video_summaries upsert가 실패해 요약 저장이 중단된다)

ALTER TABLE video_summaries
  ADD COLUMN IF NOT EXISTS tldr TEXT;
