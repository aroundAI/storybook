-- Migration: Add episode publishing configs
-- Links episodes to account-level platform connections with language mapping

-- =============================================================================
-- 1. EPISODE_PUBLISHING_CONFIGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.episode_publishing_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  
  -- Link to account-level connection
  platform_connection_id UUID NOT NULL REFERENCES public.platform_connections(id) ON DELETE CASCADE,
  
  -- Which language version to publish (maps to localized_videos)
  language VARCHAR(5) NOT NULL DEFAULT 'en',
  
  -- Episode-specific content overrides
  title_override VARCHAR(200),
  description_override TEXT,
  tags_override TEXT[],
  thumbnail_override_url TEXT,
  
  -- Publishing preferences
  publish_immediately BOOLEAN DEFAULT false,
  scheduled_publish_at TIMESTAMPTZ,
  
  -- Status tracking
  is_enabled BOOLEAN DEFAULT true,
  last_published_at TIMESTAMPTZ,
  last_published_video_id VARCHAR(255),  -- Platform's video ID
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Constraints
  CONSTRAINT episode_publishing_language_check 
    CHECK (language IN ('en', 'hi', 'es', 'pt')),
  
  -- One config per episode + connection + language
  CONSTRAINT episode_publishing_unique 
    UNIQUE(episode_id, platform_connection_id, language)
);

-- =============================================================================
-- 2. INDEXES
-- =============================================================================

-- Query by episode
CREATE INDEX IF NOT EXISTS idx_episode_publishing_episode_id 
  ON public.episode_publishing_configs(episode_id);

-- Query enabled configs for an episode
CREATE INDEX IF NOT EXISTS idx_episode_publishing_enabled 
  ON public.episode_publishing_configs(episode_id, is_enabled) 
  WHERE is_enabled = true;

-- Query by connection (for cleanup when connection deleted)
CREATE INDEX IF NOT EXISTS idx_episode_publishing_connection 
  ON public.episode_publishing_configs(platform_connection_id);

-- =============================================================================
-- 3. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.episode_publishing_configs ENABLE ROW LEVEL SECURITY;

-- Access via episode -> project -> account
CREATE POLICY episode_publishing_select_policy ON public.episode_publishing_configs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = episode_publishing_configs.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY episode_publishing_insert_policy ON public.episode_publishing_configs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = episode_publishing_configs.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY episode_publishing_update_policy ON public.episode_publishing_configs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = episode_publishing_configs.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY episode_publishing_delete_policy ON public.episode_publishing_configs
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = episode_publishing_configs.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- =============================================================================
-- 4. TRIGGER
-- =============================================================================

CREATE TRIGGER episode_publishing_set_timestamps
  BEFORE INSERT OR UPDATE ON public.episode_publishing_configs
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- =============================================================================
-- 5. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_publishing_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_publishing_configs TO service_role;

-- =============================================================================
-- 6. COMMENTS
-- =============================================================================

COMMENT ON TABLE public.episode_publishing_configs IS 'Maps episodes to platform connections with language routing';
COMMENT ON COLUMN public.episode_publishing_configs.language IS 'Which localized video to publish: en, hi, es, pt';
COMMENT ON COLUMN public.episode_publishing_configs.title_override IS 'Episode-specific title override for this platform';
COMMENT ON COLUMN public.episode_publishing_configs.publish_immediately IS 'Auto-publish when video is rendered';
