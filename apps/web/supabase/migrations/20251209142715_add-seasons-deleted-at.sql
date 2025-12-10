-- FILM-302: Add soft delete support to seasons table
-- This migration adds the deleted_at column for soft delete functionality

-- Add deleted_at column for soft delete
ALTER TABLE public.seasons
ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone DEFAULT NULL;

-- Add comment for the new column
COMMENT ON COLUMN public.seasons.deleted_at IS 'Soft delete timestamp - NULL means active';

-- Add index for soft delete filtering (find deleted records)
CREATE INDEX IF NOT EXISTS idx_seasons_deleted_at ON public.seasons(deleted_at)
WHERE deleted_at IS NOT NULL;

-- Drop and recreate index to filter on non-deleted records
DROP INDEX IF EXISTS idx_seasons_project_number;
CREATE INDEX idx_seasons_project_number ON public.seasons(project_id, number)
WHERE deleted_at IS NULL;
