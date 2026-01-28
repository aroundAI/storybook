-- ==================================
-- Section: Master Video & Title Card Extension (FILM-716) - Update
-- ==================================
-- Updates to support 1:N Title Cards and 1:1 Master Video

-- 1. Add episode_id to assets (Link Title Cards to Episode)
ALTER TABLE public.assets
ADD COLUMN IF NOT EXISTS episode_id uuid REFERENCES public.episodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_episode_id ON public.assets(episode_id);

-- 2. Remove master_title_card_asset_id from episodes (handled via assets.episode_id + type='master_title_card')
ALTER TABLE public.episodes
DROP COLUMN IF EXISTS master_title_card_asset_id;
