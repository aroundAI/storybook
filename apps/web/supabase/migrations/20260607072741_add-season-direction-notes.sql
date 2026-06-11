-- Add direction_notes column to seasons table
-- Creative direction notes that influence story/screenplay generation for all episodes in this season
ALTER TABLE public.seasons
ADD COLUMN IF NOT EXISTS direction_notes text;

COMMENT ON COLUMN public.seasons.direction_notes IS 'Creative direction notes that influence story/screenplay generation for all episodes in this season';
