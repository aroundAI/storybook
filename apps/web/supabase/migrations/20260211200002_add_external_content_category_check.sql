-- =============================================================================
-- FILM-1135: Add CHECK constraint on external_content.category
-- =============================================================================
-- The external_sources table already has a CHECK constraint on category,
-- but external_content (denormalized for performance) was missing one.

ALTER TABLE external_content
  ADD CONSTRAINT chk_external_content_category CHECK (
    category IN ('news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia')
  );
