-- Migration: Add multi-language support for localization
-- 
-- Enables content publishing in multiple languages (EN, HI, ES, PT):
-- 1. Add language tracking to dialogue_lines
-- 2. Add localized video URLs to episodes

-- =============================================================================
-- 1. DIALOGUE LINES - Add language support
-- =============================================================================

-- Add language column (default to English for existing data)
ALTER TABLE dialogue_lines 
ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'en';

-- Add reference to source dialogue for translations
ALTER TABLE dialogue_lines 
ADD COLUMN IF NOT EXISTS source_dialogue_id UUID REFERENCES dialogue_lines(id);

-- Index for efficient language-based queries
CREATE INDEX IF NOT EXISTS idx_dialogue_lines_episode_language 
ON dialogue_lines(episode_id, language);

-- Add comment for documentation
COMMENT ON COLUMN dialogue_lines.language IS 'Language code: en=English, hi=Hindi, es=Spanish, pt=Portuguese';
COMMENT ON COLUMN dialogue_lines.source_dialogue_id IS 'Reference to original dialogue line this was translated from';

-- =============================================================================
-- 2. EPISODES - Add localized video URLs
-- =============================================================================

-- Store final video URLs per language as JSON
ALTER TABLE episodes
ADD COLUMN IF NOT EXISTS localized_videos JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN episodes.localized_videos IS 'Final video URLs by language: {"en": "url", "hi": "url", "es": "url", "pt": "url"}';
