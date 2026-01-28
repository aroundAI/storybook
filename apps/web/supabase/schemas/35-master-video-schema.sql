-- ==================================
-- Section: Master Video & Title Card Extension (FILM-716)
-- ==================================
-- Extensions for Master Video Record Keeping

-- 1. Add file_hash column for deduplication to assets
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS file_hash text,
ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
ADD COLUMN IF NOT EXISTS content_type text;
CREATE INDEX IF NOT EXISTS idx_assets_file_hash ON public.assets(file_hash);
-- Index for fast deduplication lookups
CREATE INDEX IF NOT EXISTS idx_assets_project_file_hash 
ON public.assets(project_id, file_hash);

-- 2. Update CHECK constraint for 'type' in assets
-- We need to drop the existing constraint and add the new one with new types
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_type_check;
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_check; -- sometimes named differently, checking widely

-- Re-add constraint with new types: master_video, master_title_card
-- Original types: 'character', 'location', 'prop', 'voice', 'music', 'sfx'
-- New types: 'master_video', 'master_title_card'
ALTER TABLE public.assets ADD CONSTRAINT assets_type_check 
CHECK (type IN ('character', 'location', 'prop', 'voice', 'music', 'sfx', 'master_video', 'master_title_card'));

-- 3. Episodes Table Extensions
ALTER TABLE public.episodes
ADD COLUMN IF NOT EXISTS master_video_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS master_title_card_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

-- Indexes for new foreign keys
CREATE INDEX IF NOT EXISTS idx_episodes_master_video_asset_id ON public.episodes(master_video_asset_id);
CREATE INDEX IF NOT EXISTS idx_episodes_master_title_card_asset_id ON public.episodes(master_title_card_asset_id);

-- Comments
COMMENT ON COLUMN public.assets.file_hash IS 'SHA-256 hash of the file content for deduplication';
COMMENT ON COLUMN public.episodes.master_video_asset_id IS 'Reference to the Clean Master Video asset';
COMMENT ON COLUMN public.episodes.master_title_card_asset_id IS 'Reference to the Master Title Card asset';
