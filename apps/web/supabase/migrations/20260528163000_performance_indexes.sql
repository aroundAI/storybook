-- Performance indexes identified by audit
-- Only creates indexes that don't already exist

-- Episodes: commonly queried by project_id + number for listing/range queries
-- (column is "number", not "episode_number")
CREATE INDEX IF NOT EXISTS idx_episodes_project_number
  ON public.episodes (project_id, number);

-- Edit clips: filtered by language in render worker
CREATE INDEX IF NOT EXISTS idx_edit_clips_language
  ON public.edit_clips (language) WHERE language IS NOT NULL;

-- Publishes: dashboard queries filter by episode_id and scheduled_at
-- (column is "scheduled_at", not "scheduled_for")
CREATE INDEX IF NOT EXISTS idx_publishes_episode_scheduled
  ON public.publishes (episode_id, scheduled_at);
