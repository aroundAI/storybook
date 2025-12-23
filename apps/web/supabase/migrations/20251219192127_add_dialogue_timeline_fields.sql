-- Add timeline positioning fields to dialogue_lines
-- These fields enable shot-based alignment of dialogue in the Audio Studio timeline

ALTER TABLE dialogue_lines
ADD COLUMN IF NOT EXISTS timeline_start_seconds DECIMAL(10, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS estimated_duration_seconds DECIMAL(8, 2) DEFAULT NULL;

-- Index for efficient timeline ordering queries
CREATE INDEX IF NOT EXISTS idx_dialogue_lines_timeline
ON dialogue_lines(episode_id, timeline_start_seconds)
WHERE timeline_start_seconds IS NOT NULL;

COMMENT ON COLUMN dialogue_lines.timeline_start_seconds IS
'Absolute position in episode timeline (seconds from start). Derived from shot positioning.';

COMMENT ON COLUMN dialogue_lines.estimated_duration_seconds IS
'Speaking duration calculated from word count (~0.4s per word or 150 words/minute).';
