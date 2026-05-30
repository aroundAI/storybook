-- Performance Audit v2: Additional indexes for common query patterns
-- These indexes target frequently-executed queries identified during performance audit

-- Scene-level shot queries: getShotsByScene() filters by episode_id + scene_number
CREATE INDEX IF NOT EXISTS idx_shots_episode_scene
  ON public.shots (episode_id, scene_number);

-- Captions query: filters completed dialogue lines ordered by timeline position
CREATE INDEX IF NOT EXISTS idx_dialogue_lines_episode_status_timeline
  ON public.dialogue_lines (episode_id, status, timeline_start_seconds)
  WHERE status = 'completed';

-- Fact filtering by project + verification status (getProjectFactsAction, getVerifiedFactsAction)
CREATE INDEX IF NOT EXISTS idx_verified_facts_project_status
  ON public.verified_facts (project_id, verification_status);

-- Canon commit thread lookup: filters by project + thread_name + status
CREATE INDEX IF NOT EXISTS idx_narrative_threads_project_name_status
  ON public.narrative_threads (project_id, thread_name, status);

-- Asset queries by episode + type for active-only records (title card lookups)
CREATE INDEX IF NOT EXISTS idx_assets_episode_type_active
  ON public.assets (episode_id, type)
  WHERE deleted_at IS NULL;
