-- Performance Audit v3: Additional indexes for common query patterns
-- Targets queries identified during the v3 performance audit

-- Fix D-1a: Shots without deleted_at filter (queries in actions.ts:211-223 don't filter deleted_at)
CREATE INDEX IF NOT EXISTS idx_shots_episode_sequence_all
  ON public.shots (episode_id, sequence_number);

-- Fix D-1b: Generation jobs with status for reset queries
-- resetEpisodeAction filters by reference_type + reference_id + status IN ('queued','processing')
CREATE INDEX IF NOT EXISTS idx_generation_jobs_reference_status
  ON public.generation_jobs (reference_type, reference_id, status)
  WHERE status IN ('queued', 'processing');

-- Fix D-1c: Audio cues episode lookup (resetEpisodeAction deletes by episode_id)
CREATE INDEX IF NOT EXISTS idx_audio_cues_episode_id
  ON public.audio_cues (episode_id);

-- Fix D-1d: Publishes standalone episode_id for revenue tracking and episode lookups
CREATE INDEX IF NOT EXISTS idx_publishes_episode_id
  ON public.publishes (episode_id);
