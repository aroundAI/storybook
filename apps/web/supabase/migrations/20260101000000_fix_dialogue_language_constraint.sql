-- Migration: Fix unique constraint to support multiple languages
-- 
-- The unique constraint on dialogue_lines needs to include language
-- to allow the same sequence_number to exist for different languages.

-- First, delete any existing Hindi translations that are blocking
-- (these were inserted with incomplete constraint)
DELETE FROM dialogue_lines 
WHERE language != 'en' 
  AND source_dialogue_id IS NOT NULL;

-- Drop the old constraint (episode_id, sequence_number)
ALTER TABLE dialogue_lines 
DROP CONSTRAINT IF EXISTS dialogue_lines_episode_id_sequence_number_key;

-- Create new constraint including language
ALTER TABLE dialogue_lines 
ADD CONSTRAINT dialogue_lines_episode_id_sequence_number_language_key 
UNIQUE (episode_id, sequence_number, language);

-- Add index for the new constraint pattern
CREATE INDEX IF NOT EXISTS idx_dialogue_lines_episode_seq_lang 
ON dialogue_lines(episode_id, sequence_number, language);
