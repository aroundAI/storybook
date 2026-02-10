-- =============================================================================
-- FILM-1135: Restrict external_sources SELECT to authenticated users
-- =============================================================================
-- Previously the "Anyone can view active sources" policy allowed unauthenticated
-- access to the external_sources table which exposes config details like
-- api_key_env names. This restricts it to authenticated users only.

DROP POLICY IF EXISTS "Anyone can view active sources" ON external_sources;

CREATE POLICY "Authenticated users can view active sources"
  ON external_sources FOR SELECT
  TO authenticated
  USING (is_active = true);
