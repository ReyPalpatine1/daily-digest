-- 일회성 정리: 자동갱신이 이미 끝났는데 남아 있는 billing_keys 행 삭제.
-- 개인정보처리방침 제1조 3항(2026-11-24 개정) — 빌링키는 자동갱신이 종료되는 때 지체 없이 삭제.
-- 이번 배포부터는 코드가 종료 시점에 바로 지운다(lib/billing-key-cleanup.ts). 이 파일은 배포 전에
-- 이미 쌓여 있던 행만 정리한다.
--
-- Supabase SQL Editor에서 ① 조회 → 건수 확인 → ② 삭제 순서로 실행.
--
-- "자동갱신이 끝났다"의 기준
--   (가) 프로필의 plan_status 가 'active' 가 아니다 (해지 후 만료·3회 실패 강등·환불·1개월권 전환 등)
--   (나) plan_status = 'active' 이지만 해지 예약(cancel_at_period_end)이고 이용기간이 이미 지났다
--   (다) 프로필이 없다 (탈퇴 후 남은 행 — 정상이라면 auth.users CASCADE 로 이미 없다)
-- ★ 해지 예약 후 만료일 전(active + cancel_at_period_end + 만료일 미도래)은 대상이 아니다 — 해지 취소 시 재사용.
-- ★ 갱신 재시도 중(active + 해지 예약 없음)도 대상이 아니다.


-- ═══ ① 대상 건수 (삭제 전 확인) ═══
SELECT
  count(*)                                                        AS total,
  count(*) FILTER (WHERE p.id IS NULL)                            AS no_profile,
  count(*) FILTER (WHERE p.id IS NOT NULL AND p.plan_status IS DISTINCT FROM 'active') AS not_active,
  count(*) FILTER (WHERE p.plan_status = 'active')                AS canceled_and_expired
FROM public.billing_keys b
LEFT JOIN public.profiles p ON p.id = b.user_id
WHERE p.id IS NULL
   OR p.plan_status IS DISTINCT FROM 'active'
   OR (p.cancel_at_period_end = true AND p.plan_expires_at IS NOT NULL AND p.plan_expires_at < now());

-- (참고) 남는 행 = 자동갱신 진행 중인 계정 수와 같아야 한다.
-- SELECT count(*) FROM public.billing_keys b JOIN public.profiles p ON p.id = b.user_id
--  WHERE p.plan_status = 'active'
--    AND NOT (p.cancel_at_period_end = true AND p.plan_expires_at IS NOT NULL AND p.plan_expires_at < now());


-- ═══ ② 삭제 — ①의 total 과 삭제된 행 수(DELETE n)가 같은지 확인 ═══
BEGIN;

DELETE FROM public.billing_keys b
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = b.user_id)
   OR EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE p.id = b.user_id
        AND (
          p.plan_status IS DISTINCT FROM 'active'
          OR (p.cancel_at_period_end = true AND p.plan_expires_at IS NOT NULL AND p.plan_expires_at < now())
        )
   );

COMMIT;
