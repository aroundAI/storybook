-- Add public_profile JSONB column to accounts
ALTER TABLE public.accounts 
  ADD COLUMN IF NOT EXISTS public_profile JSONB DEFAULT '{}'::jsonb;

-- Add GIN index for JSONB queries on accounts
CREATE INDEX IF NOT EXISTS idx_accounts_public_profile 
  ON public.accounts USING GIN (public_profile);

-- Ensure slug is unique and not null for team accounts (if not already enforced)
-- Note: slug is typically managed via application logic, but unique constraint is good practice
-- DO action if constraints don't exist:
-- ALTER TABLE public.accounts ADD CONSTRAINT accounts_slug_unique UNIQUE (slug);

COMMENT ON COLUMN public.accounts.public_profile IS 
  'Public profile settings: {is_public, display_name, bio, website_url, social_links, custom_styles}';

-- Add visibility to projects
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private' 
  CHECK (visibility IN ('private', 'public', 'unlisted'));

-- Add public_slug to projects
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

-- Add SEO metadata to projects
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

-- Unique constraint for public_slug per account on projects
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_public_slug_account 
  ON public.projects(account_id, public_slug) 
  WHERE public_slug IS NOT NULL;

-- Index for project visibility queries
CREATE INDEX IF NOT EXISTS idx_projects_visibility 
  ON public.projects(visibility) 
  WHERE visibility = 'public';

COMMENT ON COLUMN public.projects.visibility IS 'private=hidden, public=visible, unlisted=link-only';
COMMENT ON COLUMN public.projects.public_slug IS 'URL-safe slug for public pages';

-- Add visibility to episodes (inherits from project by default)
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'inherit' 
  CHECK (visibility IN ('inherit', 'private', 'public', 'unlisted'));

-- Add public_slug to episodes
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

-- Add SEO metadata to episodes
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

-- Add localized videos (YT/FB per language) to episodes
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS localized_videos JSONB DEFAULT '{}'::jsonb;

-- Unique constraint for public_slug per project on episodes
CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_public_slug_project 
  ON public.episodes(project_id, public_slug) 
  WHERE public_slug IS NOT NULL;

-- GIN index for localized_videos language queries on episodes
CREATE INDEX IF NOT EXISTS idx_episodes_localized_videos 
  ON public.episodes USING GIN (localized_videos);

COMMENT ON COLUMN public.episodes.localized_videos IS 
  'Per-language video links: {"en": {"youtube": {...}, "facebook": {...}}}';
