-- 토스 심사 계정(tossreview@test.com) 정리.
-- Supabase SQL Editor에서 ① → ② → ③ 순서로 실행. ③은 ①·②를 확인한 뒤에만 실행할 것.
--
-- 기준: 회원 탈퇴 API(app/api/account/delete/route.ts)가 처리하는 테이블과 같다.
--   shared_summaries  → 지우지 않고 blocked_at 으로 비공개 처리(탈퇴와 동일)
--   send_log, email_logs, digests, channels, categories, settings → 삭제
--   profiles → 삭제, 마지막으로 auth.users → 삭제
-- 공유 풀(videos, video_summaries, channel_fetch_state)은 건드리지 않는다.
--
-- ⚠️ 결제 기록 보관
--   payments.user_id, billing_keys.user_id 는 auth.users(id) ON DELETE CASCADE 다
--   (sql/payments.sql, sql/billing_keys.sql). auth.users 를 지우면 두 테이블의 행이
--   보관 없이 함께 사라진다. 그래서 ③은 이 계정의 payments·billing_keys 행이 1건이라도
--   있으면 예외를 내고 전체를 롤백한다. 행이 있으면 따로 판단한 뒤 처리할 것.
--   payments_archive 에는 user_id 가 없어(탈퇴 이관 시 계정 연결을 끊음) 이메일로만 조회하며,
--   이 SQL은 payments_archive 를 절대 수정하지 않는다.
--
-- 그 밖에 auth.users / profiles 삭제 때 함께 바뀌는 것(레포의 sql/ 기준)
--   feedback.user_id → profiles(id) ON DELETE SET NULL: 피드백 내용은 남고 user_id 만 NULL 이 된다.
--   profiles·channels·categories·settings·digests·shared_summaries 의 외래키는 레포에 정의가 없다
--   (대시보드에서 생성). 실제 동작은 ②의 결과로 확인할 것.


-- ═══ ① 삭제 전 확인: 테이블별 이 계정의 행 수 ═══
WITH u AS (
  SELECT id, email FROM auth.users WHERE lower(email) = 'tossreview@test.com'
)
SELECT 'auth.users'                     AS tbl, count(*) AS cnt FROM u
UNION ALL SELECT 'profiles',            count(*) FROM public.profiles      WHERE id         IN (SELECT id FROM u)
UNION ALL SELECT 'settings',            count(*) FROM public.settings      WHERE user_id    IN (SELECT id FROM u)
UNION ALL SELECT 'categories',          count(*) FROM public.categories    WHERE user_id    IN (SELECT id FROM u)
UNION ALL SELECT 'channels',            count(*) FROM public.channels      WHERE user_id    IN (SELECT id FROM u)
UNION ALL SELECT 'digests',             count(*) FROM public.digests       WHERE user_id    IN (SELECT id FROM u)
UNION ALL SELECT 'email_logs',          count(*) FROM public.email_logs    WHERE user_id    IN (SELECT id FROM u)
UNION ALL SELECT 'send_log',            count(*) FROM public.send_log      WHERE user_id    IN (SELECT id FROM u)
UNION ALL SELECT 'shared_summaries (공개 중)', count(*) FROM public.shared_summaries WHERE shared_by IN (SELECT id FROM u) AND blocked_at IS NULL
UNION ALL SELECT 'feedback (SET NULL 대상)',   count(*) FROM public.feedback  WHERE user_id IN (SELECT id FROM u)
UNION ALL SELECT '★ payments (보관 대상)',      count(*) FROM public.payments  WHERE user_id IN (SELECT id FROM u)
UNION ALL SELECT '★ billing_keys (보관 대상)',  count(*) FROM public.billing_keys WHERE user_id IN (SELECT id FROM u)
UNION ALL SELECT '★ payments_archive (이메일)', count(*) FROM public.payments_archive WHERE lower(email) = 'tossreview@test.com';
-- auth.users 가 정확히 1, ★ 세 줄이 모두 0 이어야 ③을 실행할 수 있다.


-- ═══ ② 외래키 확인: auth.users / profiles 를 참조하는 외래키와 삭제 시 동작 ═══
-- confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
SELECT conrelid::regclass AS child_table,
       confrelid::regclass AS parent_table,
       conname,
       confdeltype
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
ORDER BY parent_table, child_table;
-- c(CASCADE) 인 public 테이블이 ①의 목록에 없다면, ③ 실행 시 그 테이블의 행도 함께 지워진다.


-- ═══ ③ 삭제 (한 트랜잭션) ═══
-- 모든 문장은 이메일로 찾은 단일 id(v_uid)에만 걸린다. 계정이 0개 또는 2개 이상이면 중단한다.
BEGIN;

DO $$
DECLARE
  v_uid uuid;
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM auth.users WHERE lower(email) = 'tossreview@test.com';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '대상 계정이 정확히 1개가 아님(%개) — 중단', v_cnt;
  END IF;
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'tossreview@test.com';

  -- 결제 기록 보호: auth.users CASCADE 로 사라지는 것을 막는다.
  IF EXISTS (SELECT 1 FROM public.payments     WHERE user_id = v_uid)
  OR EXISTS (SELECT 1 FROM public.billing_keys WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'payments/billing_keys 에 이 계정 행이 있음 — 결제 기록 보관 판단 후 다시 실행';
  END IF;

  -- 공유 링크 비공개(탈퇴 API와 동일 — 행은 남긴다)
  UPDATE public.shared_summaries SET blocked_at = now()
   WHERE shared_by = v_uid AND blocked_at IS NULL;

  -- 자식 테이블
  DELETE FROM public.send_log   WHERE user_id = v_uid;
  DELETE FROM public.email_logs WHERE user_id = v_uid;
  DELETE FROM public.digests    WHERE user_id = v_uid;
  DELETE FROM public.channels   WHERE user_id = v_uid;
  DELETE FROM public.categories WHERE user_id = v_uid;
  DELETE FROM public.settings   WHERE user_id = v_uid;

  -- 부모(feedback.user_id 는 ON DELETE SET NULL 로 분리된다)
  DELETE FROM public.profiles WHERE id = v_uid;

  -- 계정 자체(payments·billing_keys CASCADE 는 위에서 0건임을 확인함)
  DELETE FROM auth.users WHERE id = v_uid;

  RAISE NOTICE '삭제 완료: %', v_uid;
END $$;

COMMIT;
-- 실행 후 ①을 다시 돌려 auth.users 포함 모든 줄이 0 인지 확인.
-- Supabase 의 Email provider(이메일+비밀번호 로그인)도 대시보드에서 끌 것.
