-- 탈퇴 회원 결제 기록 분리 보관: payments_archive 테이블 + payments.method 컬럼.
-- Supabase SQL Editor에서 실행하세요. (★ 코드 배포 전에 먼저 실행할 것 —
--  탈퇴 API가 payments_archive에 이관하지 못하면 탈퇴 자체를 중단하므로, 이 테이블이 없으면
--  모든 탈퇴가 실패한다. 결제 승인 마감도 payments.method를 쓰므로 컬럼이 없으면
--  결제 기록이 pending으로 남는다)
--
-- 왜 분리 보관하나
--   payments는 auth.users ON DELETE CASCADE라 탈퇴하면 결제 기록이 함께 사라진다.
--   그런데 전자상거래법상 대금결제 기록은 5년 보존 의무가 있다(개인정보처리방침 제3조 3항).
--   그래서 탈퇴 시 필요한 항목만 이 테이블로 옮기고, 계정과의 연결(user_id)은 끊는다.
--
--   - user_id를 두지 않는다 — 탈퇴 후에는 어느 계정의 결제였는지 알 수 없어야 한다.
--     문의·분쟁 대응은 주문번호·결제 키·이메일로 찾는다.
--   - email은 탈퇴 시점의 로그인 이메일 원문이다(처리방침에 "탈퇴 후에도 이메일 주소가 보관됩니다" 고지).
--   - paid_at = 원본 payments.created_at. 5년 파기의 기준일이다.
--   - 정책을 두지 않아 RLS가 모든 직접 접근을 막고 service_role(서버·관리자 API)만 우회한다
--     (payments·billing_keys와 같은 패턴).
--   - 5년 경과분은 매월 1일(KST) 서버 정리 작업이 삭제한다(lib/payments-archive.ts).
-- 예상 결과: public.payments_archive 테이블 + 인덱스 1개 + RLS 활성화(정책 0개),
--           payments에 method 컬럼 1개 추가. 재실행해도 멱등.

CREATE TABLE IF NOT EXISTS public.payments_archive (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     text NOT NULL UNIQUE,              -- 주문번호. unique라 이관 재시도가 중복을 만들지 않는다
  payment_key  text,                              -- 토스 결제 식별자
  amount       int NOT NULL,
  currency     text NOT NULL DEFAULT 'KRW',
  kind         text NOT NULL,                     -- 상품 구분: 'auto'(자동 갱신) | 'onetime'(1개월권)
  status       text NOT NULL,                     -- 원본 결제 상태(done/canceled/pending)
  method       text,                              -- 결제수단 유형(토스 응답 method). 컬럼 추가 전 결제는 비어 있다
  email        text,                              -- 탈퇴 시점 이메일 원문
  paid_at      timestamptz NOT NULL,              -- 결제일(원본 created_at) — 5년 파기 기준
  refunded_at  timestamptz,                       -- 환불 일시
  archived_at  timestamptz NOT NULL DEFAULT now()
);

-- 5년 경과분 정리(paid_at 범위 삭제).
CREATE INDEX IF NOT EXISTS payments_archive_paid_at_idx ON public.payments_archive(paid_at);

ALTER TABLE public.payments_archive ENABLE ROW LEVEL SECURITY;

-- 결제수단 유형: 승인 성공 시 토스 응답의 method('카드', '간편결제' 등)를 기록한다.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method text;
