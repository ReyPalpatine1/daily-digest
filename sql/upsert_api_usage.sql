-- 병렬 처리 시 (user_id, date, service) UNIQUE 충돌(23505) 방지용 RPC
-- 한 번의 INSERT ... ON CONFLICT DO UPDATE 로 atomic하게 누적
CREATE OR REPLACE FUNCTION increment_api_usage(
  p_user_id uuid,
  p_date date,
  p_service text,
  p_calls integer,
  p_input_tokens integer,
  p_output_tokens integer
) RETURNS void AS $$
  INSERT INTO api_usage (
    user_id, date, service,
    api_calls, input_tokens, output_tokens, tokens_used
  )
  VALUES (
    p_user_id, p_date, p_service,
    p_calls, p_input_tokens, p_output_tokens,
    p_input_tokens + p_output_tokens
  )
  ON CONFLICT (user_id, date, service) DO UPDATE SET
    api_calls = api_usage.api_calls + EXCLUDED.api_calls,
    input_tokens = api_usage.input_tokens + EXCLUDED.input_tokens,
    output_tokens = api_usage.output_tokens + EXCLUDED.output_tokens,
    tokens_used = api_usage.tokens_used + EXCLUDED.input_tokens + EXCLUDED.output_tokens,
    updated_at = NOW();
$$ LANGUAGE SQL;
