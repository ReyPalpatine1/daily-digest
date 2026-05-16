-- Phase 10: 사용자별 이메일 언어 설정
-- Supabase SQL Editor에서 실행하세요.

-- settings 테이블에 언어 설정 컬럼 추가
ALTER TABLE settings ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'ko';

-- 언어별 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_settings_locale ON settings(locale);

-- 기존 사용자는 모두 'ko'로 설정 (DEFAULT가 ko라 자동 처리되지만 명시)
UPDATE settings SET locale = 'ko' WHERE locale IS NULL;
