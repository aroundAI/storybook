-- Add video trimming columns to shots table
-- Phase 1: Video Clip Trimming
-- These columns enable frame-accurate in/out point control for uploaded videos

ALTER TABLE shots
ADD COLUMN IF NOT EXISTS trim_in_point NUMERIC(10, 3) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS trim_out_point NUMERIC(10, 3) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS source_duration NUMERIC(10, 3) DEFAULT NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN shots.trim_in_point IS 'In-point for video trimming in seconds (start of clip). Precision: milliseconds.';
COMMENT ON COLUMN shots.trim_out_point IS 'Out-point for video trimming in seconds (end of clip). Precision: milliseconds.';
COMMENT ON COLUMN shots.source_duration IS 'Original source video duration in seconds. Used to validate trim points.';
