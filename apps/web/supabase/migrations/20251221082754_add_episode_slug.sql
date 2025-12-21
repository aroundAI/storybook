-- Add slug column to episodes table for human-readable URLs
-- Slug is unique within a project (allows same slug in different projects)

-- Add slug column
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS slug text;

-- Create unique index (slug unique within project, excluding soft-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_project_slug
  ON public.episodes(project_id, slug)
  WHERE deleted_at IS NULL;

-- Create index for slug lookups
CREATE INDEX IF NOT EXISTS idx_episodes_slug
  ON public.episodes(slug)
  WHERE deleted_at IS NULL;

-- Backfill existing episodes with slugs based on number and title
-- Format: episode-{number}-{title-slug}
UPDATE public.episodes
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      CONCAT('episode-', number, '-', COALESCE(SUBSTRING(title, 1, 30), '')),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-+', '-', 'g'
  )
)
WHERE slug IS NULL;

-- Clean up trailing/leading dashes from slugs
UPDATE public.episodes
SET slug = TRIM(BOTH '-' FROM slug)
WHERE slug LIKE '-%' OR slug LIKE '%-';

-- Add comment
COMMENT ON COLUMN public.episodes.slug IS 'Human-readable URL slug, unique within project (e.g., episode-1-pilot)';
