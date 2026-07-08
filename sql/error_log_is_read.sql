-- 관리자 오류 로그 읽음 상태: error_log에 is_read 컬럼 + 부분 인덱스 추가.
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것)
--
-- 목적: 관리자 오류 탭에서 새(안 읽은) 오류를 하이라이트/뱃지로 강조하고
--   클릭 시 읽음 처리하기 위한 상태 컬럼. 새 오류 행은 기본 안 읽음(false)으로 생성.
-- 예상 결과: error_log.is_read 컬럼(boolean NOT NULL DEFAULT false),
--   안 읽은 항목 조회용 부분 인덱스 1개 추가. (재실행해도 에러 없이 멱등)

-- 1) 읽음 상태 컬럼
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

-- 2) 안 읽은 항목 카운트/필터 조회용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_error_log_unread ON error_log(occurred_at DESC) WHERE is_read = false;

-- 참고: 기존 행들은 DEFAULT false로 채워져 모두 "안 읽음"이 된다.
-- 과거 오류까지 새로 강조되는 게 부담이면 아래 한 줄로 기존 행을 읽음 처리해도 된다(사용자 판단).
-- (선택) 기존 오류를 모두 읽음으로 처리하려면: UPDATE error_log SET is_read = true;
