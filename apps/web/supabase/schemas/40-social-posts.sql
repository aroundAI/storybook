-- =============================================================================
-- Social Posts
-- Standalone social media text posts (decoupled from episodes)
-- Supports LinkedIn text posts with AI-generated content from user notes
-- =============================================================================

-- Social Posts Table
CREATE TABLE IF NOT EXISTS public.social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  platform_connection_id UUID REFERENCES public.platform_connections(id) ON DELETE SET NULL,

  -- Source content
  raw_notes TEXT NOT NULL,

  -- Research context (from Brave Search)
  research_context JSONB DEFAULT '{}',

  -- Generated content
  generated_variants JSONB DEFAULT '[]',
  selected_variant_index INT DEFAULT 0,
  final_text TEXT,

  -- Post metadata
  hashtags TEXT[] DEFAULT '{}',
  platform VARCHAR(20) NOT NULL DEFAULT 'linkedin',
  visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC',

  -- Workflow
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,

  -- LinkedIn response
  platform_post_id TEXT,
  platform_url TEXT,

  -- Tracking
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.social_posts IS 'Standalone social media text posts with AI-generated content from user notes';
COMMENT ON COLUMN public.social_posts.raw_notes IS 'Original notes/commentary pasted by the user';
COMMENT ON COLUMN public.social_posts.research_context IS 'Research data from Brave Search (news, web results) used to enrich content';
COMMENT ON COLUMN public.social_posts.generated_variants IS 'AI-generated post variants [{text, style, hashtags, hookPreview}]';
COMMENT ON COLUMN public.social_posts.selected_variant_index IS 'Index of the variant chosen by the user';
COMMENT ON COLUMN public.social_posts.final_text IS 'The final post text to publish (may be edited from variant)';
COMMENT ON COLUMN public.social_posts.status IS 'draft | ready_to_review | approved | publishing | published | failed';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_posts_account
  ON public.social_posts(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_posts_status
  ON public.social_posts(status, created_at DESC)
  WHERE status IN ('approved', 'publishing');

-- RLS
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage social posts for accounts they belong to
CREATE POLICY social_posts_select ON public.social_posts
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM public.accounts WHERE id = auth.uid()
      UNION ALL
      SELECT account_id FROM public.accounts_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY social_posts_insert ON public.social_posts
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM public.accounts WHERE id = auth.uid()
      UNION ALL
      SELECT account_id FROM public.accounts_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY social_posts_update ON public.social_posts
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM public.accounts WHERE id = auth.uid()
      UNION ALL
      SELECT account_id FROM public.accounts_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY social_posts_delete ON public.social_posts
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM public.accounts WHERE id = auth.uid()
      UNION ALL
      SELECT account_id FROM public.accounts_memberships WHERE user_id = auth.uid()
    )
    AND status NOT IN ('published')
  );

-- Updated at trigger (reuse existing function from the codebase)
CREATE OR REPLACE TRIGGER social_posts_updated_at
  BEFORE UPDATE ON public.social_posts
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime('updated_at');
