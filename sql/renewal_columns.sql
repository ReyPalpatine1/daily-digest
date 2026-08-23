-- 정기 갱신·해지 상태 컬럼: profiles에 4개 추가.
-- Supabase SQL Editor에서 실행하세요. (★ 코드 배포 전에 먼저 실행할 것 —
--  applyPaidPlan이 이 컬럼들을 함께 갱신하므로, 없으면 결제 후 플랜 반영이 실패한다)
--
-- 목적: 자동 갱신(plan_status='active')의 재결제·실패 대응·해지 예약 상태를 담는다.
--   - cancel_at_period_end : 해지를 눌렀지만 기간이 남은 상태. 만료일에 재결제하지 않고 그대로 종료.
--                            즉시 무료로 내리지 않는 이유는 이미 결제한 기간이 남아 있기 때문(약관 기준).
--   - renew_failed_at      : 마지막 갱신 시도 시각. 15분 cron이 같은 사람을 반복 결제하지 않도록
--                            "마지막 시도 후 24시간" 재시도 간격 판정에 쓴다.
--   - renew_fail_count     : 연속 실패 횟수. 3회면 무료로 강등한다.
--   - renew_notified_at    : 실패/종료 안내 메일 중복 발송 방지 워터마크
--                            (체험 알림 플래그와 같은 방식. 결제 성공 시 전부 초기화된다).
-- 예상 결과: profiles에 컬럼 4개 추가. 재실행해도 에러 없이 멱등(IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renew_failed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS renew_fail_count     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renew_notified_at    timestamptz;
