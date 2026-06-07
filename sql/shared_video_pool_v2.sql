-- 4b단계: 공유 풀 스키마 보정 (key_points/timeline을 JSONB로).
-- shared_video_pool.sql을 이미 실행했다면 이 파일만 추가로 실행하면 된다.
-- (아직 데이터가 없으므로 TEXT→JSONB 변환은 무손실)
-- Supabase SQL Editor에서 실행하세요.

-- 풀 테이블이 아직 없다면 JSONB로 생성
CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,     -- UTC
  duration_seconds INT,
  is_short BOOLEAN DEFAULT false,
  description TEXT,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id, published_at);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at);

CREATE TABLE IF NOT EXISTS video_summaries (
  video_id TEXT PRIMARY KEY REFERENCES videos(video_id),
  summary TEXT,
  key_points JSONB,
  timeline JSONB,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS uploads_playlist_id TEXT;

CREATE TABLE IF NOT EXISTS channel_fetch_state (
  channel_id TEXT PRIMARY KEY,
  uploads_playlist_id TEXT,
  last_fetched_at TIMESTAMPTZ,
  last_video_published_at TIMESTAMPTZ
);

-- v1을 TEXT로 만들었던 경우에만 JSONB로 변환 (데이터 없을 때 안전)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'video_summaries' AND column_name = 'key_points' AND data_type = 'text'
  ) THEN
    ALTER TABLE video_summaries ALTER COLUMN key_points TYPE JSONB USING key_points::jsonb;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'video_summaries' AND column_name = 'timeline' AND data_type = 'text'
  ) THEN
    ALTER TABLE video_summaries ALTER COLUMN timeline TYPE JSONB USING timeline::jsonb;
  END IF;
END $$;

-- 미요약 영상 빠른 조회용 (요약 적재 anti-join 보조)
CREATE INDEX IF NOT EXISTS idx_videos_short_published ON videos(is_short, published_at);
