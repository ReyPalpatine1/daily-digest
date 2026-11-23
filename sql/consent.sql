-- 첫 로그인 동의(이용약관·개인정보처리방침·만 14세 이상·광고성 정보 수신) 기록 + 환영 메일 워터마크.
-- Supabase SQL Editor에서 실행하세요. (★ 코드 배포 전에 실행할 것 —
--  대시보드 동의 팝업·/api/consent·동의 전 차단(채널 추가·미리보기·결제)이 이 컬럼들을 읽고 쓰므로,
--  없으면 동의 확인이 실패해 해당 기능이 모두 막힌다)
--
--   - terms_agreed_at  : 이용약관·개인정보처리방침 동의 시각 (비어 있으면 동의 팝업 표시)
--   - terms_version    : 동의 당시 약관 버전 (현재 '2026-11-24')
--   - age_confirmed_at : 만 14세 이상 확인 시각
--   - ad_consent       : 광고성 정보 수신 동의 여부 (기본 false — 미리 체크하지 않음)
--   - ad_consent_at    : 광고성 정보 수신 동의 시각
--   - ad_withdrawn_at  : 광고성 정보 수신 동의 철회 시각
--   - welcome_sent_at  : 환영 메일 발송(선점) 시각 — 비어 있을 때만 1회 발송
--
-- 기존 회원 처리
--   - terms_agreed_at·age_confirmed_at·ad_consent는 비워 둔다(기존 회원도 동의 화면을 거친다).
--   - welcome_sent_at은 기존 행 전부 now()로 채운다(기존 회원에게 환영 메일을 보내지 않는다).
--     ★ 이 채우기는 welcome_sent_at 컬럼을 "처음 만들 때 한 번만" 실행된다.
--       배포 후 재실행해도 아직 동의 전인 신규 가입자의 환영 메일을 막지 않는다.
--
-- 예상 결과: profiles에 컬럼 7개 추가. 재실행해도 에러 없이 멱등(IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_agreed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version    text,
  ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ad_consent       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ad_consent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ad_withdrawn_at  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'welcome_sent_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN welcome_sent_at timestamptz;
    -- 기존 회원 전원: 환영 메일 발송 완료로 간주
    UPDATE public.profiles SET welcome_sent_at = now();
  END IF;
END $$;
