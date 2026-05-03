-- api_usage 테이블에 서비스/토큰 분리 컬럼 추가
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS service text NOT NULL DEFAULT 'gemini';
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0;

-- 기존 (user_id, date) 유니크 → (user_id, date, service)로 교체
ALTER TABLE api_usage DROP CONSTRAINT IF EXISTS api_usage_user_id_date_key;
ALTER TABLE api_usage
  ADD CONSTRAINT api_usage_user_id_date_service_key UNIQUE (user_id, date, service);

-- 서비스/날짜 집계용 인덱스
CREATE INDEX IF NOT EXISTS idx_api_usage_service_date ON api_usage (service, date);
