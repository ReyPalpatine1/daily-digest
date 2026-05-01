-- Supabase에서 실행할 SQL 스크립트입니다.
-- 날짜별 Gemini API 사용량을 집계하는 테이블을 생성합니다.

create extension if not exists "pgcrypto";

CREATE TABLE IF NOT EXISTS api_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  date date NOT NULL,
  api_calls integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE OR REPLACE FUNCTION update_api_usage_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_usage_update_timestamp
BEFORE UPDATE ON api_usage
FOR EACH ROW
EXECUTE FUNCTION update_api_usage_timestamp();
