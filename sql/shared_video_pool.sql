-- 4a단계: 대규모 대비 "채널 공유" 구조용 스키마.
-- 수집(채널 단위, 사용자 무관)과 발송(사용자별)을 분리하기 위한 공유 풀.
-- ⚠️ 이번 단계는 테이블 생성 + 설계만. 기존 발송 로직(digests 기반)은 그대로 동작.
-- Supabase SQL Editor에서 실행하세요.

-- 공유 영상 풀 (채널 단위, 사용자 무관)
CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,     -- UTC
  duration_seconds INT,                  -- 쇼츠 판별
  is_short BOOLEAN DEFAULT false,
  description TEXT,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id, published_at);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at);

-- 공유 요약 (영상당 1번, 모든 사용자 공유)
CREATE TABLE IF NOT EXISTS video_summaries (
  video_id TEXT PRIMARY KEY REFERENCES videos(video_id),
  summary TEXT,
  key_points TEXT,
  timeline TEXT,
  model TEXT,                            -- 어떤 모델로 요약했는지
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 채널 메타 (조회 캐싱용) — 업로드 재생목록 ID 보관
ALTER TABLE channels ADD COLUMN IF NOT EXISTS uploads_playlist_id TEXT;

-- 채널별 조회 상태 (전역 채널 단위, 중복 조회 방지)
CREATE TABLE IF NOT EXISTS channel_fetch_state (
  channel_id TEXT PRIMARY KEY,
  uploads_playlist_id TEXT,
  last_fetched_at TIMESTAMPTZ,
  last_video_published_at TIMESTAMPTZ    -- 마지막으로 본 영상 시각
);

-- 참고: 속보(breaking) 키워드는 사용자별이므로 videos에 is_breaking을 넣지 않는다.
--       속보 판정은 발송 시 각 사용자의 keyword로 수행한다.
