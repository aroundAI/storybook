-- Add deleted_at column for soft delete support (FILM-201)
ALTER TABLE public.assets
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.assets.deleted_at IS 'Soft delete timestamp - null means active';

-- Add index for soft delete filtering (active assets)
CREATE INDEX IF NOT EXISTS idx_assets_deleted_at
ON public.assets(deleted_at) WHERE deleted_at IS NULL;

-- Add partial index for project + type queries excluding deleted
CREATE INDEX IF NOT EXISTS idx_assets_project_type_active
ON public.assets(project_id, type) WHERE deleted_at IS NULL;

-- Add index for created_at ordering with soft delete filter
CREATE INDEX IF NOT EXISTS idx_assets_created_at_active
ON public.assets(created_at DESC) WHERE deleted_at IS NULL;
