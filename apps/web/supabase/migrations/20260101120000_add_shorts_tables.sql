-- Migration: Add shorts and short_publications tables
-- Enables auto-clipping of shots to 9:16 vertical format and multi-platform publishing

-- =============================================================================
-- 1. SHORTS TABLE - Generated vertical clips from shots
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  source_shot_id UUID REFERENCES public.shots(id) ON DELETE SET NULL,
  
  -- Clip boundaries (in seconds from episode start)
  start_seconds FLOAT NOT NULL,
  end_seconds FLOAT NOT NULL,
  duration_seconds FLOAT GENERATED ALWAYS AS (end_seconds - start_seconds) STORED,
  
  -- Content metadata
  title VARCHAR(200),
  caption TEXT,
  hashtags TEXT[],
  
  -- From shot viral analysis
  viral_score INT CHECK (viral_score BETWEEN 1 AND 10),
  hook_type VARCHAR(50), -- question, reveal, conflict, visual, humor, cliffhanger
  standalone_summary TEXT,
  
  -- Generated files
  video_url_9x16 TEXT,        -- 1080x1920 vertical crop
  video_url_original TEXT,    -- Original aspect ratio clip
  thumbnail_url TEXT,
  
  -- Processing status
  status VARCHAR(20) DEFAULT 'pending' NOT NULL,
  -- pending → processing → ready → failed
  processing_error TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Constraints
  CONSTRAINT shorts_status_check CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  CONSTRAINT shorts_duration_positive CHECK (end_seconds > start_seconds),
  CONSTRAINT shorts_duration_limit CHECK ((end_seconds - start_seconds) <= 180) -- Max 3 min
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shorts_episode_id ON public.shorts(episode_id);
CREATE INDEX IF NOT EXISTS idx_shorts_source_shot_id ON public.shorts(source_shot_id);
CREATE INDEX IF NOT EXISTS idx_shorts_status ON public.shorts(status);
CREATE INDEX IF NOT EXISTS idx_shorts_viral_score ON public.shorts(viral_score DESC) WHERE viral_score >= 7;

-- Enable RLS
ALTER TABLE public.shorts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (access via episode -> project -> account)
CREATE POLICY shorts_select_policy ON public.shorts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = shorts.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY shorts_insert_policy ON public.shorts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = shorts.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY shorts_update_policy ON public.shorts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = shorts.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY shorts_delete_policy ON public.shorts
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = shorts.episode_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Trigger for updated_at
CREATE TRIGGER shorts_set_timestamps
  BEFORE INSERT OR UPDATE ON public.shorts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- =============================================================================
-- 2. SHORT_PUBLICATIONS TABLE - Track publishing to platforms
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.short_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id UUID NOT NULL REFERENCES public.shorts(id) ON DELETE CASCADE,
  
  -- Target platform + language
  platform VARCHAR(50) NOT NULL,  -- youtube, tiktok, instagram, facebook
  language VARCHAR(5) NOT NULL DEFAULT 'en',  -- en, hi, es, pt
  platform_connection_id UUID REFERENCES public.platform_connections(id) ON DELETE SET NULL,
  
  -- Platform-specific content (may differ from short's content)
  title_override VARCHAR(200),
  caption_override TEXT,
  hashtags_override TEXT[],
  
  -- Published content identifiers
  platform_video_id VARCHAR(255),
  platform_url TEXT,
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  
  -- Status
  status VARCHAR(20) DEFAULT 'draft' NOT NULL,
  -- draft → scheduled → publishing → published → failed
  publish_error TEXT,
  
  -- Analytics (synced from platform)
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  analytics_updated_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Constraints
  CONSTRAINT short_publications_platform_check 
    CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook')),
  CONSTRAINT short_publications_language_check 
    CHECK (language IN ('en', 'hi', 'es', 'pt')),
  CONSTRAINT short_publications_status_check 
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  
  -- Unique: one publication per short + platform + language
  CONSTRAINT short_publications_unique UNIQUE(short_id, platform, language)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_short_publications_short_id ON public.short_publications(short_id);
CREATE INDEX IF NOT EXISTS idx_short_publications_platform ON public.short_publications(platform, language);
CREATE INDEX IF NOT EXISTS idx_short_publications_status ON public.short_publications(status);
CREATE INDEX IF NOT EXISTS idx_short_publications_scheduled ON public.short_publications(scheduled_at) 
  WHERE status = 'scheduled';

-- Enable RLS
ALTER TABLE public.short_publications ENABLE ROW LEVEL SECURITY;

-- RLS Policies (access via short -> episode -> project -> account)
CREATE POLICY short_publications_select_policy ON public.short_publications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shorts s
      JOIN public.episodes e ON s.episode_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE s.id = short_publications.short_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY short_publications_insert_policy ON public.short_publications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shorts s
      JOIN public.episodes e ON s.episode_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE s.id = short_publications.short_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY short_publications_update_policy ON public.short_publications
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shorts s
      JOIN public.episodes e ON s.episode_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE s.id = short_publications.short_id
      AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY short_publications_delete_policy ON public.short_publications
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shorts s
      JOIN public.episodes e ON s.episode_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE s.id = short_publications.short_id
      AND public.has_role_on_account(p.account_id)
    )
  );

-- Trigger for updated_at
CREATE TRIGGER short_publications_set_timestamps
  BEFORE INSERT OR UPDATE ON public.short_publications
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- =============================================================================
-- 3. ADD LANGUAGE TO PLATFORM_CONNECTIONS
-- =============================================================================

-- Add language column for language-specific channels (EN YT, HI YT, etc.)
ALTER TABLE public.platform_connections
ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';

-- Update unique constraint to include language
-- (Allows: account + youtube + EN, account + youtube + HI as separate connections)
ALTER TABLE public.platform_connections
DROP CONSTRAINT IF EXISTS platform_connections_unique;

ALTER TABLE public.platform_connections
ADD CONSTRAINT platform_connections_unique 
  UNIQUE(account_id, platform, platform_account_id, language);

-- Index for language-based queries
CREATE INDEX IF NOT EXISTS idx_platform_connections_language 
  ON public.platform_connections(account_id, platform, language);

-- =============================================================================
-- 4. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shorts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shorts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.short_publications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.short_publications TO service_role;

-- =============================================================================
-- 5. COMMENTS
-- =============================================================================

COMMENT ON TABLE public.shorts IS 'Generated vertical clips (9:16) from episode shots for TikTok/Reels/Shorts';
COMMENT ON COLUMN public.shorts.viral_score IS 'LLM-rated viral potential (1-10) from shot analysis';
COMMENT ON COLUMN public.shorts.hook_type IS 'Type of hook: question, reveal, conflict, visual, humor, cliffhanger';
COMMENT ON COLUMN public.shorts.video_url_9x16 IS 'URL to 1080x1920 vertical crop of the clip';

COMMENT ON TABLE public.short_publications IS 'Track publishing of shorts to platforms (YouTube, TikTok, etc.)';
COMMENT ON COLUMN public.short_publications.language IS 'Target language channel: en, hi, es, pt';
COMMENT ON COLUMN public.short_publications.platform_video_id IS 'Video ID on the platform after publishing';
