-- 구독 종료 안내 메일 워터마크: profiles에 1개 추가.
-- Supabase SQL Editor에서 실행하세요. (★ 코드 배포 전에 먼저 실행할 것 —
--  sendPendingEndedNotices가 이 컬럼을 조건·기록에 쓰므로, 없으면 종료 안내가 전부 실패한다)
--
-- 왜 별도 컬럼인가
--   renew_notified_at 하나로 "1차 결제 실패 안내"와 "3회 실패 후 종료 안내"를 모두 막고 있었다.
--   1차 안내를 받은 계정은 renew_notified_at이 채워져 종료 안내 조건(is null)에 영영 걸리지 않았고,
--   역설적으로 수신 주소가 없어 1차를 건너뛴 계정만 대상이 됐다 — 그 계정은 보낼 주소가 없다.
--   결과적으로 아무도 종료 안내를 받지 못했다.
--   강등 직전에 renew_notified_at을 null로 되돌리는 방식은 쓰지 않는다.
--   한 컬럼을 두 의미로 계속 쓰는 구조가 남아 같은 사고가 재발하기 때문이다.
--
--   - sub_ended_notified_at : 3회 실패 강등 후 종료 안내를 보낸 시각.
--                             renew_notified_at(1차 실패 안내)과 용도를 완전히 분리한다.
--                             재구독 시 두 컬럼 모두 null로 초기화된다
--                             (applyPaidPlan / activateAutoRenew).
-- 예상 결과: profiles에 컬럼 1개 추가. 재실행해도 에러 없이 멱등(IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sub_ended_notified_at timestamptz;
