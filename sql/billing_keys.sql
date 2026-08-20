-- 토스 자동결제 빌링키 보관: billing_keys 테이블 + RLS(정책 없음 = service_role 전용).
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것)
--
-- 목적: 카드 등록(빌링키 발급) 결과를 서버만 읽을 수 있는 곳에 둔다.
--   - 빌링키는 그것만으로 결제를 일으킬 수 있는 민감값이라 profiles에 두지 않는다.
--     (profiles는 본인 행 SELECT가 열려 있어 컬럼이 그대로 노출된다.)
--   - 정책을 하나도 만들지 않아 RLS가 모든 접근을 막고, service_role(API)만 우회한다.
--   - card_label은 화면 표시용 마스킹 문자열만 담는다. 카드번호 원문은 저장하지 않는다.
--   - 재등록 시 user_id 기준 upsert로 교체된다(사용자당 1장).
-- 예상 결과: public.billing_keys 테이블 생성 + RLS 활성화(정책 0개). 재실행해도 에러 없이 멱등.

CREATE TABLE IF NOT EXISTS public.billing_keys (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, -- 탈퇴 시 함께 삭제
  billing_key  text NOT NULL,                    -- 토스 빌링키(민감 — 서버 외부로 내보내지 말 것)
  customer_key text NOT NULL,                    -- 토스 customerKey = 사용자 UUID
  card_label   text,                             -- 예: '신한 **** 1234' (표시용 마스킹만)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_keys ENABLE ROW LEVEL SECURITY;
