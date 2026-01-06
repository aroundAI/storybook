-- ============================================================================
-- Migration: Add SFX/Music enhancements and Audio Cues table
-- Extends existing audio_assets with looping support and adds audio_cues
-- ============================================================================

-- =============================================================================
-- 1. ENHANCE AUDIO_ASSETS TABLE
-- =============================================================================

-- Add loopable flag for ambient sounds
ALTER TABLE public.audio_assets 
ADD COLUMN IF NOT EXISTS is_loopable boolean DEFAULT false;

-- Add tags array for categorization and search
ALTER TABLE public.audio_assets 
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Add 'ambient' to audio_type check (may need to recreate constraint)
-- First check if ambient is already allowed
DO $$ 
BEGIN
  -- Drop existing constraint if it exists
  ALTER TABLE public.audio_assets DROP CONSTRAINT IF EXISTS audio_assets_audio_type_check;
  
  -- Add new constraint with 'ambient' included
  ALTER TABLE public.audio_assets 
  ADD CONSTRAINT audio_assets_audio_type_check 
  CHECK (audio_type IN ('music', 'sfx', 'ambient'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Index for tags (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_audio_assets_tags 
ON public.audio_assets USING gin(tags);

COMMENT ON COLUMN public.audio_assets.is_loopable IS 'Whether this asset loops seamlessly (for ambient sounds)';
COMMENT ON COLUMN public.audio_assets.tags IS 'Tags for categorization and search (e.g., footsteps, outdoor)';

-- =============================================================================
-- 2. ADD AUDIO_ASSET_ID TO AUDIO_TRACKS
-- =============================================================================

ALTER TABLE public.audio_tracks
ADD COLUMN IF NOT EXISTS audio_asset_id uuid REFERENCES public.audio_assets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audio_tracks.audio_asset_id IS 'Reference to reusable audio asset from project library';

CREATE INDEX IF NOT EXISTS idx_audio_tracks_asset 
ON public.audio_tracks(audio_asset_id) 
WHERE audio_asset_id IS NOT NULL;

-- =============================================================================
-- 3. AUDIO CUES TABLE (LLM-generated cues from screenplay)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audio_cues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  scene_number integer NOT NULL,
  cue_type text NOT NULL,
  prompt text NOT NULL,
  start_offset_seconds numeric(10,2) DEFAULT 0,
  duration_seconds numeric(10,2),
  is_loopable boolean DEFAULT false,
  audio_asset_id uuid REFERENCES public.audio_assets(id) ON DELETE SET NULL,
  audio_track_id uuid REFERENCES public.audio_tracks(id) ON DELETE SET NULL,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT audio_cues_type_check CHECK (cue_type IN ('sfx', 'music', 'ambient')),
  CONSTRAINT audio_cues_status_check CHECK (status IN ('pending', 'matched', 'generating', 'placed', 'failed'))
);

COMMENT ON TABLE public.audio_cues IS 'LLM-generated audio cues from screenplay for SFX and music';
COMMENT ON COLUMN public.audio_cues.prompt IS 'ElevenLabs-optimized prompt for audio generation';
COMMENT ON COLUMN public.audio_cues.start_offset_seconds IS 'Start time relative to scene beginning';
COMMENT ON COLUMN public.audio_cues.audio_asset_id IS 'Matched or generated audio asset from library';
COMMENT ON COLUMN public.audio_cues.audio_track_id IS 'Timeline placement for this cue';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audio_cues_episode ON public.audio_cues(episode_id);
CREATE INDEX IF NOT EXISTS idx_audio_cues_scene ON public.audio_cues(episode_id, scene_number);
CREATE INDEX IF NOT EXISTS idx_audio_cues_status ON public.audio_cues(status) WHERE status = 'pending';

-- =============================================================================
-- 4. ROW LEVEL SECURITY FOR AUDIO_CUES
-- =============================================================================

ALTER TABLE public.audio_cues ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view audio cues for episodes they have access to
CREATE POLICY audio_cues_select_policy ON public.audio_cues
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      INNER JOIN public.seasons s ON s.id = e.season_id
      INNER JOIN public.projects p ON p.id = s.project_id
      WHERE e.id = audio_cues.episode_id
        AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY audio_cues_insert_policy ON public.audio_cues
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.episodes e
      INNER JOIN public.seasons s ON s.id = e.season_id
      INNER JOIN public.projects p ON p.id = s.project_id
      WHERE e.id = audio_cues.episode_id
        AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY audio_cues_update_policy ON public.audio_cues
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      INNER JOIN public.seasons s ON s.id = e.season_id
      INNER JOIN public.projects p ON p.id = s.project_id
      WHERE e.id = audio_cues.episode_id
        AND public.has_role_on_account(p.account_id)
    )
  );

CREATE POLICY audio_cues_delete_policy ON public.audio_cues
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.episodes e
      INNER JOIN public.seasons s ON s.id = e.season_id
      INNER JOIN public.projects p ON p.id = s.project_id
      WHERE e.id = audio_cues.episode_id
        AND public.has_role_on_account(p.account_id)
    )
  );
