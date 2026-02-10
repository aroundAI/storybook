-- FILM-1135 follow-up: Fix FTS index and add updated_at trigger on external_content
-- M4: The original FTS index was on an expression (title || description) but Supabase
--     textSearch() queries only the title column. Add a generated tsvector column
--     that the GIN index and queries can both use consistently.
-- m5: Add BEFORE UPDATE trigger on external_content (was missing, only external_sources had one).

-- =============================================================================
-- 1. Add generated tsvector column for full-text search
-- =============================================================================

ALTER TABLE external_content
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || COALESCE(description, ''))
  ) STORED;

-- Drop the old expression-based index and create one on the new column
DROP INDEX IF EXISTS idx_external_content_fts;
CREATE INDEX idx_external_content_fts ON external_content USING GIN(fts);

-- =============================================================================
-- 2. Add updated_at trigger on external_content
-- =============================================================================

CREATE TRIGGER set_external_content_updated_at
  BEFORE UPDATE ON external_content
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
