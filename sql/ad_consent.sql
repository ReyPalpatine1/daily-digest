-- 코드 배포 전에 실행. 재실행 안전.
-- 광고성 정보 수신 동의 2년 재확인 통지(정보통신망법 시행령 제62조의3) 워터마크.
-- Supabase SQL Editor에서 실행하세요.
--
--   - ad_reconfirm_notified_at : 2년 재확인 통지를 마지막으로 보낸 시각.
--       대상 = ad_consent=true AND now() >= COALESCE(ad_reconfirm_notified_at, ad_consent_at) + 2년
--       (/api/cron → lib/ad-consent.ts runAdReconfirmNotices가 조건부 UPDATE로 선점 후 1회 발송)
--       다시 동의하면 null로 초기화된다(새 동의 시각부터 2년을 다시 센다).
--
-- 전제: sql/consent.sql(ad_consent·ad_consent_at·ad_withdrawn_at)이 먼저 실행되어 있어야 한다.
-- 예상 결과: profiles에 컬럼 1개 추가. 재실행해도 에러 없이 멱등(IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ad_reconfirm_notified_at timestamptz;
