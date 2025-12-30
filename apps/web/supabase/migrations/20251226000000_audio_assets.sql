-- Migration: Add audio_assets table for reusable music/SFX library
-- Part of ElevenLabs Music & SFX integration

-- Add 'music' and 'sfx' to asset_type enum if not exists
DO $$ BEGIN
  -- Check if types already exist in assets table type column
  -- We'll handle this by allowing these values in assets
END $$;

-- Create audio_assets table for storing generated audio with deduplication
CREATE TABLE IF NOT EXISTS public.audio_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to main assets table (optional - for library assets)
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  
  -- Project scope (audio assets are project-specific for now)
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  
  -- Type of audio: 'music' or 'sfx'
  audio_type TEXT NOT NULL CHECK (audio_type IN ('music', 'sfx')),
  
  -- Deduplication: hash of normalized prompt
  prompt_hash TEXT NOT NULL,
  
  -- Original prompt text
  prompt TEXT NOT NULL,
  
  -- Human-readable name for the asset
  name TEXT,
  
  -- Audio file details
  file_url TEXT,
  file_path TEXT,
  duration_seconds NUMERIC,
  file_size_bytes BIGINT,
  
  -- Provider info
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  provider_job_id TEXT,
  
  -- Generation status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  
  -- Metadata (genre, mood, tags, etc.)
  metadata JSONB DEFAULT '{}',
  
  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at TIMESTAMPTZ
);

-- Index for prompt hash lookup (deduplication)
CREATE INDEX IF NOT EXISTS idx_audio_assets_prompt_hash 
  ON public.audio_assets(project_id, prompt_hash) 
  WHERE deleted_at IS NULL;

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_audio_assets_type 
  ON public.audio_assets(project_id, audio_type) 
  WHERE deleted_at IS NULL;

-- Index for status filtering (find pending generations)
CREATE INDEX IF NOT EXISTS idx_audio_assets_status 
  ON public.audio_assets(status) 
  WHERE status IN ('pending', 'processing');

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_audio_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audio_assets_updated_at
  BEFORE UPDATE ON public.audio_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_audio_assets_updated_at();

-- RLS Policies
ALTER TABLE public.audio_assets ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view audio assets for projects they have access to
CREATE POLICY audio_assets_select_policy ON public.audio_assets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = audio_assets.project_id
        AND public.has_role_on_account(p.account_id)
    )
  );

-- Policy: Users can insert audio assets for projects they have access to
CREATE POLICY audio_assets_insert_policy ON public.audio_assets
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = audio_assets.project_id
        AND public.has_role_on_account(p.account_id)
    )
  );

-- Policy: Users can update audio assets for projects they have access to
CREATE POLICY audio_assets_update_policy ON public.audio_assets
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = audio_assets.project_id
        AND public.has_role_on_account(p.account_id)
    )
  );

-- Policy: Users can delete audio assets for projects they have access to
CREATE POLICY audio_assets_delete_policy ON public.audio_assets
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = audio_assets.project_id
        AND public.has_role_on_account(p.account_id)
    )
  );

-- Comment
COMMENT ON TABLE public.audio_assets IS 'Reusable audio library for music and SFX with deduplication via prompt hashing';
