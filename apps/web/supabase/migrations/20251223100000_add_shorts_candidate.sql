-- Add shorts candidate metadata to shots table
-- This allows marking shots as suitable for short-form content (TikTok, Reels, YT Shorts)

-- Add shorts candidate columns to shots
ALTER TABLE shots 
ADD COLUMN IF NOT EXISTS shorts_candidate BOOLEAN DEFAULT false;

ALTER TABLE shots 
ADD COLUMN IF NOT EXISTS shorts_metadata JSONB DEFAULT NULL;

-- shorts_metadata schema:
-- {
--   "viralScore": 1-10,           -- LLM-rated viral potential
--   "hookType": "question|reveal|conflict|visual|humor",
--   "suggestedStartOffset": 0,    -- seconds from shot start for optimal clip
--   "suggestedDuration": 15-60,   -- optimal clip duration
--   "standaloneSummary": "...",   -- brief context so clip makes sense
--   "hashtags": ["#keyword"]      -- suggested hashtags
-- }

-- Index for querying shorts candidates
CREATE INDEX IF NOT EXISTS idx_shots_shorts_candidate 
ON shots(episode_id, shorts_candidate) 
WHERE shorts_candidate = true;

-- Add comment for documentation
COMMENT ON COLUMN shots.shorts_candidate IS 'Whether this shot is suitable for short-form content';
COMMENT ON COLUMN shots.shorts_metadata IS 'Metadata for shorts: viralScore, hookType, suggestedDuration, etc.';
