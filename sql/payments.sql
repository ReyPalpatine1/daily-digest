-- 결제 내역: payments 테이블 + 인덱스 + RLS(정책 없음 = service_role 전용).
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것)
--
-- 목적: 자동 갱신(빌링키)·1개월권(단건) 결제의 주문과 결과를 남긴다.
--   - order_id는 우리가 만든 주문번호이고 unique다 → 그 자체가 멱등성 키다.
--     결과 화면에서 새로고침해도 같은 주문이 두 번 승인되지 않는다.
--   - 승인 요청 "전에" status='pending'으로 먼저 넣는다 —
--     승인은 됐는데 기록이 없는 상태(가장 수습하기 어려운 상태)를 막기 위해서다.
--   - 결제 내역은 서버가 조회해 내려준다. 정책을 두지 않아 RLS가 모든 직접 접근을 막고
--     service_role(API)만 우회한다(billing_keys와 같은 패턴).
--   - 카드번호·빌링키는 이 테이블에 넣지 않는다. payment_key는 토스 결제 식별자일 뿐이다.
-- 예상 결과: public.payments 테이블 + 인덱스 1개 + RLS 활성화(정책 0개). 재실행해도 멱등.

CREATE TABLE IF NOT EXISTS public.payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- 탈퇴 시 함께 삭제
  order_id     text NOT NULL UNIQUE,          -- 서버가 만든 주문번호(멱등성 키)
  payment_key  text,                          -- 토스 결제 식별자(승인 성공 후 기록)
  amount       int NOT NULL,                  -- 결제 금액. 승인 시 이 값과 대조한다(위변조 방지)
  kind         text NOT NULL,                 -- 'auto'(자동 갱신) | 'onetime'(1개월권)
  status       text NOT NULL,                 -- 'pending' | 'done' | 'failed' | 'canceled'
  receipt_url  text,
  fail_code    text,
  fail_message text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 사용자별 최신순 조회(결제 내역 화면·문의 대응).
CREATE INDEX IF NOT EXISTS payments_user_idx ON public.payments(user_id, created_at DESC);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
