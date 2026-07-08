-- 사용자 피드백 수집: feedback 테이블 + 인덱스 + RLS.
-- Supabase SQL Editor에서 실행하세요. (코드 배포 전에 먼저 실행할 것)
--
-- 목적: 사용자가 남긴 별점/유형/메시지를 내부 수집한다.
--   - 열람·상태변경은 service_role(관리자 API)만 가능(RLS 우회).
--   - 일반 사용자는 본인 행 INSERT만 가능하며, 자신의 것도 조회 불가(내부 수집 목적).
--   - 탈퇴 시 user_id만 NULL로 분리하고 피드백 내용은 보존(ON DELETE SET NULL).
-- 예상 결과: public.feedback 테이블, 인덱스 2개(created_at DESC / status),
--   RLS 활성화 + 본인 INSERT 정책 1개 생성. (재실행해도 에러 없이 멱등)

-- 1) 테이블
CREATE TABLE IF NOT EXISTS public.feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL, -- 탈퇴 시 신원만 분리, 내용 보존
  rating     smallint CHECK (rating BETWEEN 1 AND 5),                -- 별점(선택 입력)
  type       text NOT NULL DEFAULT 'general'
             CHECK (type IN ('general','bug','feature')),
  message    text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  status     text NOT NULL DEFAULT 'new'
             CHECK (status IN ('new','read','resolved')),            -- 관리자 처리 상태
  is_public  boolean NOT NULL DEFAULT false,                         -- 미래 테스티모니얼 공개용(현재 미사용)
  locale     text,                                                   -- 제출 시 언어(ko/en/zh/ja 등)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) 인덱스
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at DESC); -- 관리자 최신순 목록
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback(status);              -- 상태 필터

-- 3) RLS
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- 로그인 사용자는 "본인(user_id = auth.uid())" 행만 삽입 가능(방어적 계층).
-- SELECT/UPDATE/DELETE 정책은 만들지 않는다 → service_role만 열람·수정(RLS 우회).
DROP POLICY IF EXISTS feedback_insert_own ON public.feedback;
CREATE POLICY feedback_insert_own ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
