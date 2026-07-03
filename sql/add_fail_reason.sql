-- 요약 실패 사유 표기: fail_reason/fail_detail + 라이브 영상 감지 컬럼.
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것 —
-- 컬럼이 없으면 수집/발송의 select·upsert가 실패한다)
--
-- fail_reason 코드:
--   no_source : 자막·설명 둘 다 없음 → 요약 불가 (Gemini 미호출)
--   temporary : 재시도 상한(3회) 소진 (503/429/JSON 파싱/기타 예외)
--   pending   : 아직 시도 중 (attempts < MAX)
--   live      : 라이브/예정 영상 (liveBroadcastContent = live | upcoming) → 요약 제외
-- fail_detail: errorInfo 원문 등 관리자 디버그용. 요약 성공 시 둘 다 null.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS fail_detail TEXT,
  ADD COLUMN IF NOT EXISTS live_broadcast_content TEXT;  -- none | live | upcoming (videos.list snippet)

ALTER TABLE digests
  ADD COLUMN IF NOT EXISTS fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS fail_detail TEXT;
