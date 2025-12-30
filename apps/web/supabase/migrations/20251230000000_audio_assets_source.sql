-- Migration: Add source column to audio_assets for upload vs generated tracking

-- Add source column to audio_assets table
ALTER TABLE public.audio_assets 
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'generated' 
CHECK (source IN ('generated', 'uploaded'));

-- Add index for filtering by source
CREATE INDEX IF NOT EXISTS idx_audio_assets_source 
  ON public.audio_assets(project_id, source) 
  WHERE deleted_at IS NULL;

-- Comment
COMMENT ON COLUMN public.audio_assets.source IS 'Source of the audio asset: generated (AI) or uploaded (user file)';
