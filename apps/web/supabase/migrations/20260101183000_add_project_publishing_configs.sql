-- Migration: Add project publishing configs
-- Platform connections are configured at project level, episodes inherit/override

-- =============================================================================
-- 1. PROJECT_PUBLISHING_CONFIGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_publishing_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  
  -- Link to account-level connection
  platform_connection_id UUID NOT NULL REFERENCES public.platform_connections(id) ON DELETE CASCADE,
  
  -- Which language version to publish (maps to localized_videos)
  language VARCHAR(5) NOT NULL DEFAULT 'en',
  
  -- Default content (can be overridden at episode level)
  default_title_suffix VARCHAR(100),  -- e.g., " | My Channel"
  default_description_template TEXT,
  default_tags TEXT[],
  
  -- Status
  is_enabled BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Constraints
  CONSTRAINT project_publishing_language_check 
    CHECK (language IN ('en', 'hi', 'es', 'pt')),
  
  -- One config per project + connection + language
  CONSTRAINT project_publishing_unique 
    UNIQUE(project_id, platform_connection_id, language)
);

-- =============================================================================
-- 2. ALTER EPISODE TABLE TO ADD OVERRIDE FIELDS
-- =============================================================================

-- Episode-level overrides: if NULL, inherit from project config
ALTER TABLE public.episode_publishing_configs
  ADD COLUMN IF NOT EXISTS inherit_from_project BOOLEAN DEFAULT true;

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_project_publishing_project_id 
  ON public.project_publishing_configs(project_id);

CREATE INDEX IF NOT EXISTS idx_project_publishing_enabled 
  ON public.project_publishing_configs(project_id, is_enabled) 
  WHERE is_enabled = true;

-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.project_publishing_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_publishing_select_policy ON public.project_publishing_configs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_publishing_configs.project_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY project_publishing_insert_policy ON public.project_publishing_configs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_publishing_configs.project_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY project_publishing_update_policy ON public.project_publishing_configs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_publishing_configs.project_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY project_publishing_delete_policy ON public.project_publishing_configs
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_publishing_configs.project_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- =============================================================================
-- 5. TRIGGER
-- =============================================================================

CREATE TRIGGER project_publishing_set_timestamps
  BEFORE INSERT OR UPDATE ON public.project_publishing_configs
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- =============================================================================
-- 6. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_publishing_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_publishing_configs TO service_role;

-- =============================================================================
-- 7. COMMENTS
-- =============================================================================

COMMENT ON TABLE public.project_publishing_configs IS 'Default platform connections for all episodes in a project';
COMMENT ON COLUMN public.project_publishing_configs.language IS 'Which localized video to publish: en, hi, es, pt';
COMMENT ON COLUMN public.project_publishing_configs.default_title_suffix IS 'Appended to episode titles when publishing';
