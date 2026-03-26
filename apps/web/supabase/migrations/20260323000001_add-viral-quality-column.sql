-- Migration: Add viral_quality column to episodes
-- Stores the Orchestrator agent's episode-level viral analysis:
-- whyThisWorks, whatToImprove, dimension scores, reel candidates with textual reasoning

ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS viral_quality JSONB DEFAULT NULL;

COMMENT ON COLUMN episodes.viral_quality IS
  'Orchestrator agent''s viral quality analysis: overall score, dimension scores, textual reasoning (whyThisWorks, whatToImprove), reel candidate reasoning per scene, and revision history.';
