-- Migration: Add shorts support for multi-language publishing
-- 
-- Adds localized_shorts column to episodes table for storing
-- short-form video URLs per language (9:16 aspect ratio content).

-- =============================================================================
-- EPISODES - Add localized shorts URLs
-- =============================================================================

-- Store short video URLs per language as JSON (same structure as localized_videos)
ALTER TABLE episodes
ADD COLUMN IF NOT EXISTS localized_shorts JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN episodes.localized_shorts IS 'Short-form video URLs by language (9:16): {"en": "url", "hi": "url", ...}';
