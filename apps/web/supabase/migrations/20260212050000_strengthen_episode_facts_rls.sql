-- FILM-1142: Strengthen episode_facts RLS with account membership checks.
-- Ensures only users who are members of the project's owning account
-- can view, link, or unlink facts.

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Users can view episode facts" ON episode_facts;
DROP POLICY IF EXISTS "Users can link facts to episodes" ON episode_facts;
DROP POLICY IF EXISTS "Users can unlink facts from episodes" ON episode_facts;

-- SELECT: user must be a member of the account that owns the project
CREATE POLICY "Users can view episode facts"
  ON episode_facts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = episode_facts.episode_id
        AND p.account_id IN (
          SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
        )
    )
  );

-- INSERT: user must be a member of the owning account
CREATE POLICY "Users can link facts to episodes"
  ON episode_facts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM episodes e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = episode_facts.episode_id
        AND p.account_id IN (
          SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
        )
    )
  );

-- DELETE: user must be a member of the owning account
CREATE POLICY "Users can unlink facts from episodes"
  ON episode_facts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = episode_facts.episode_id
        AND p.account_id IN (
          SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
        )
    )
  );
