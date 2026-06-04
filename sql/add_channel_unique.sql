-- 중복 채널 방지용 unique 인덱스 (선택 사항)
-- 정규화 규칙: 소문자 + 쿼리 파라미터/프로토콜/www/끝슬래시 제거
--   → lib/channel-url.ts 의 normalizeChannelUrl 과 동일
-- Supabase SQL Editor에서 실행하세요.

-- 1) 먼저 기존 중복 데이터 확인 (있으면 인덱스 생성이 실패함)
--    아래 쿼리 결과가 있으면, 코드 레벨 체크만 사용하거나 중복을 먼저 정리하세요.
--    (기존 데이터는 강제 삭제하지 않습니다 — 수동 확인 후 처리)
SELECT
  user_id,
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(url)), '\?.*$', ''),
        '^https?://', ''),
      '^www\.', ''),
    '/$', '') AS norm_url,
  count(*) AS cnt
FROM channels
GROUP BY user_id, norm_url
HAVING count(*) > 1;

-- 2) 중복이 없다면 아래 unique 인덱스 생성
--    (user_id + 정규화 URL) 조합이 유일하도록 강제
CREATE UNIQUE INDEX IF NOT EXISTS channels_user_norm_url_uniq
ON channels (
  user_id,
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(url)), '\?.*$', ''),
        '^https?://', ''),
      '^www\.', ''),
    '/$', '')
);
