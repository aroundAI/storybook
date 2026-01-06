-- Migration: Add grouped shorts support
-- 
-- Changes localized_shorts from flat {lang: url} to grouped structure
-- where each group has its own metadata (title, description, tags) and
-- language-specific video URLs.

-- =============================================================================
-- EPISODES - Add shorts_groups column
-- =============================================================================

-- New structure for grouped shorts
-- Each group has: id, name, title, description, tags, videos (by language)
ALTER TABLE episodes
ADD COLUMN IF NOT EXISTS shorts_groups JSONB DEFAULT '[]';

COMMENT ON COLUMN episodes.shorts_groups IS 'Grouped shorts with per-group metadata: [{id, name, title, description, tags, videos: {lang: url}}]';

-- =============================================================================
-- MIGRATE EXISTING DATA - Move localized_shorts to shorts_groups
-- =============================================================================

-- If localized_shorts has any data, migrate it to Group 1
UPDATE episodes
SET shorts_groups = jsonb_build_array(
    jsonb_build_object(
        'id', 'group-1',
        'name', 'Default Group',
        'title', COALESCE(title, ''),
        'description', COALESCE(description, ''),
        'tags', '[]'::jsonb,
        'videos', localized_shorts
    )
)
WHERE localized_shorts IS NOT NULL 
  AND localized_shorts != '{}'::jsonb
  AND (shorts_groups IS NULL OR shorts_groups = '[]'::jsonb);

-- Keep localized_shorts for backward compatibility but mark as deprecated
COMMENT ON COLUMN episodes.localized_shorts IS '[DEPRECATED] Use shorts_groups instead. Short-form video URLs by language.';
