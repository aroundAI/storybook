-- Add episode_id to assets to allow linking assets to episodes (e.g. master title cards)
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS episode_id uuid REFERENCES public.episodes(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_assets_episode_id ON public.assets(episode_id);

-- Comment
COMMENT ON COLUMN public.assets.episode_id IS 'Optional reference to an episode (e.g., for master title cards or episode-specific assets)';
