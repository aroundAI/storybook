-- Migration: Add target_duration_seconds to episodes table
-- This allows each episode to have its own target duration, overriding project defaults
-- Duration range: 60 seconds (1 minute) to 7200 seconds (2 hours)

-- Add target_duration_seconds column to episodes table
ALTER TABLE public.episodes
ADD COLUMN IF NOT EXISTS target_duration_seconds integer;

-- Add check constraint for valid duration range
-- NULL means use project default
ALTER TABLE public.episodes
ADD CONSTRAINT episodes_target_duration_check
CHECK (target_duration_seconds IS NULL OR (target_duration_seconds >= 60 AND target_duration_seconds <= 7200));

-- Add comment for documentation
COMMENT ON COLUMN public.episodes.target_duration_seconds IS 'Target episode duration in seconds (60-7200). NULL uses project default from projects.metadata.defaultEpisodeDuration.';
