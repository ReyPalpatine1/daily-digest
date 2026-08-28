-- 결제 수동 복구 이력: payments에 2개 추가.
-- Supabase SQL Editor에서 실행하세요. (★ 코드 배포 전에 먼저 실행할 것 —
--  /admin/payments의 조회·복구가 이 컬럼을 select·update에 쓰므로, 없으면 탭 전체가 실패한다)
--
-- 무엇을 남기나
--   "결제는 성공했는데 Pro가 켜지지 않은" 계정을 관리자가 화면에서 수동 복구한 이력이다.
--   승인 직후 플랜 반영이 끊기는 사고(applyPaidPlan 실패·타임아웃 등)는 reconcilePaidPlans가
--   알림만 보내고 자동 복구는 하지 않는다 — 환불로 내린 계정과 사고로 안 켜진 계정을
--   시스템이 구분할 수 없기 때문이다. 그래서 사람이 판단하고, 그 판단을 여기에 남긴다.
--
--   - recovered_at : 복구를 실행한 시각.
--                    ★ 이력인 동시에 잠금이다. 복구는 applyPaidPlan으로 30일을 새로 붙이므로,
--                      같은 결제로 두 번 누르면 60일이 된다. 이 값이 있으면 복구 API가
--                      409 already_recovered로 거절해 이중 적용을 막는다.
--                      (만료일이 결제일보다 미래인지도 함께 보지만, 그 검사만으로는
--                       사용자가 그 사이 스스로 재결제한 경우와 구분되지 않는다)
--   - recovered_by : 복구를 실행한 관리자 이메일. 결제 금액이 걸린 조작이라
--                    누가 했는지가 남아야 문의 대응 때 경위를 되짚을 수 있다.
--                    관리자 계정이 지워져도 기록이 남도록 uuid 참조가 아닌 text로 둔다.
-- 예상 결과: payments에 컬럼 2개 추가. 재실행해도 에러 없이 멱등(IF NOT EXISTS).

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS recovered_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS recovered_by text;
