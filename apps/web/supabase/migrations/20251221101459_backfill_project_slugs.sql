-- Migration: Backfill project slugs
-- Generates URL-friendly slugs from project names for existing projects

-- Update existing projects that don't have slugs
UPDATE public.projects
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(name, '[^a-zA-Z0-9\s-]', '', 'g'),  -- Remove special chars
      '\s+', '-', 'g'  -- Replace spaces with hyphens
    ),
    '-+', '-', 'g'  -- Replace multiple hyphens with single
  )
)
WHERE slug IS NULL;

-- Handle any potential duplicates within the same account by appending a suffix
-- This uses a CTE to find duplicates and update them
WITH duplicates AS (
  SELECT
    id,
    slug,
    account_id,
    ROW_NUMBER() OVER (PARTITION BY account_id, slug ORDER BY created_at) as rn
  FROM public.projects
  WHERE slug IS NOT NULL
)
UPDATE public.projects p
SET slug = d.slug || '-' || d.rn
FROM duplicates d
WHERE p.id = d.id
  AND d.rn > 1;
