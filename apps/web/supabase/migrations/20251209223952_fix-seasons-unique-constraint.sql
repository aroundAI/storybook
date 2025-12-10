-- FILM-302: Fix unique constraint to allow reuse of season numbers after soft delete
-- The original unique constraint includes soft-deleted records, preventing number reuse

-- Drop the existing unique constraint
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_project_id_number_key;

-- Create a partial unique index that only applies to non-deleted records
-- This allows reusing season numbers after soft-deleting a season
CREATE UNIQUE INDEX IF NOT EXISTS seasons_project_id_number_active_idx
ON public.seasons(project_id, number)
WHERE deleted_at IS NULL;
