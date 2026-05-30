-- Performance indexes v4 — canon hot paths and voice profiles
-- Only includes indexes not already created in previous migrations

-- immutable_events: queried by (project_id) for canon validation and event listing
CREATE INDEX IF NOT EXISTS idx_immutable_events_project
  ON public.immutable_events (project_id);

-- character_details: queried by (asset_id) for voice profile lookups
CREATE INDEX IF NOT EXISTS idx_character_details_asset_id
  ON public.character_details (asset_id);

-- external_content: composite index for cache lookups by (category, cache_expires_at)
-- Supplements existing idx_external_content_category which only covers category
CREATE INDEX IF NOT EXISTS idx_external_content_category_cache
  ON public.external_content (category, cache_expires_at);
