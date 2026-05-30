-- 병렬 처리(동시 5개) 시 (user_id, date, service) UNIQUE(=api_usage_user_id_date_service_key)
-- 충돌(23505) 방지용 atomic upsert RPC.
--
-- 이전에 다른 시그니처(p_calls 포함)로 함수가 만들어졌을 수 있으므로 안전하게 정리.
DROP FUNCTION IF EXISTS increment_api_usage(uuid, date, text, integer, integer, integer);
DROP FUNCTION IF EXISTS increment_api_usage(uuid, text, date, bigint, bigint);

CREATE OR REPLACE FUNCTION increment_api_usage(
  p_user_id uuid,
  p_service text,
  p_date date,
  p_input_tokens bigint DEFAULT 0,
  p_output_tokens bigint DEFAULT 0
) RETURNS void AS $$
BEGIN
  INSERT INTO api_usage (
    user_id, service, date,
    api_calls, input_tokens, output_tokens, tokens_used
  )
  VALUES (
    p_user_id, p_service, p_date,
    1, p_input_tokens, p_output_tokens,
    p_input_tokens + p_output_tokens
  )
  ON CONFLICT (user_id, date, service) DO UPDATE SET
    api_calls = api_usage.api_calls + 1,
    input_tokens = api_usage.input_tokens + p_input_tokens,
    output_tokens = api_usage.output_tokens + p_output_tokens,
    tokens_used = api_usage.tokens_used + p_input_tokens + p_output_tokens,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
