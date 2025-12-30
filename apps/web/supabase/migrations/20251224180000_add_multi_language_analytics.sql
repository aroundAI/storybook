-- Migration: Add multi-language analytics columns to publishes table
-- 
-- This enables tracking which language version was published, linking to dubbed versions,
-- and tracing shorts back to their source shots for analytics.

-- =============================================================================
-- PUBLISHES TABLE - Add language and source tracking columns
-- =============================================================================

-- Add language column to publishes
-- Stores the language of this specific publish (en, hi, es, pt, etc.)
ALTER TABLE public.publishes
ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'en';

-- Add dubbed_version_id to link to the specific dubbed version
-- NULL for original language content
ALTER TABLE public.publishes
ADD COLUMN IF NOT EXISTS dubbed_version_id UUID REFERENCES public.dubbed_versions(id) ON DELETE SET NULL;

-- Add source_shot_id for shorts to trace back to original clip
-- NULL for full episodes/non-clip content
ALTER TABLE public.publishes
ADD COLUMN IF NOT EXISTS source_shot_id UUID REFERENCES public.shots(id) ON DELETE SET NULL;

-- =============================================================================
-- INDEXES for analytics aggregation
-- =============================================================================

-- Index for aggregating by language
CREATE INDEX IF NOT EXISTS idx_publishes_language 
ON public.publishes(language);

-- Composite index for language + content_type aggregation
CREATE INDEX IF NOT EXISTS idx_publishes_content_type_language 
ON public.publishes(content_type, language);

-- Index for platform + language combinations
CREATE INDEX IF NOT EXISTS idx_publishes_platform_language 
ON public.publishes(platform, language);

-- Index for shorts source lookup
CREATE INDEX IF NOT EXISTS idx_publishes_source_shot_id 
ON public.publishes(source_shot_id) 
WHERE source_shot_id IS NOT NULL;

-- Index for dubbed version lookup
CREATE INDEX IF NOT EXISTS idx_publishes_dubbed_version_id 
ON public.publishes(dubbed_version_id) 
WHERE dubbed_version_id IS NOT NULL;

-- =============================================================================
-- COMMENTS for documentation
-- =============================================================================

COMMENT ON COLUMN public.publishes.language IS 'ISO 639-1 language code of this publish: en=English, hi=Hindi, es=Spanish, pt=Portuguese, etc.';
COMMENT ON COLUMN public.publishes.dubbed_version_id IS 'Reference to the dubbed version if this is dubbed content (NULL for original language)';
COMMENT ON COLUMN public.publishes.source_shot_id IS 'Reference to the source shot if this is a short-form clip (NULL for full episodes)';
