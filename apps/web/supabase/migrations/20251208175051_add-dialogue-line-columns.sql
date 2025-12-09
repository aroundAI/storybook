-- ============================================================================
-- Migration: Add scene_number, character_name, emotion columns to dialogue_lines
-- Ticket: FILM-306 (Screenplay Conversion)
-- ============================================================================
-- These columns support screenplay conversion which extracts dialogue from
-- generated screenplays and stores them for voice generation (Phase 5).

ALTER TABLE public.dialogue_lines
ADD COLUMN IF NOT EXISTS scene_number integer,
ADD COLUMN IF NOT EXISTS character_name varchar(255),
ADD COLUMN IF NOT EXISTS emotion varchar(100);

-- Add comments for new columns
COMMENT ON COLUMN public.dialogue_lines.scene_number IS 'Scene number this dialogue belongs to';
COMMENT ON COLUMN public.dialogue_lines.character_name IS 'Name of the character speaking this line';
COMMENT ON COLUMN public.dialogue_lines.emotion IS 'Emotional context from screenplay parenthetical';

-- Add index for scene lookups (episode + scene number)
CREATE INDEX IF NOT EXISTS idx_dialogue_lines_scene
ON public.dialogue_lines(episode_id, scene_number)
WHERE scene_number IS NOT NULL;

-- Add index for character lookups
CREATE INDEX IF NOT EXISTS idx_dialogue_lines_character_name
ON public.dialogue_lines(character_name)
WHERE character_name IS NOT NULL;
