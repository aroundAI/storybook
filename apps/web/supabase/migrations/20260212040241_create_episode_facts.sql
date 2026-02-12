-- FILM-1142: Create episode_facts junction table
-- Links verified facts to specific episodes for Canon Dashboard integration.

CREATE TABLE IF NOT EXISTS episode_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  fact_id UUID NOT NULL REFERENCES verified_facts(id) ON DELETE CASCADE,
  linked_by UUID REFERENCES auth.users(id),
  linked_at TIMESTAMPTZ DEFAULT now(),
  scene_reference TEXT,

  CONSTRAINT uq_episode_fact UNIQUE (episode_id, fact_id)
);

-- Indexes
CREATE INDEX idx_episode_facts_episode ON episode_facts(episode_id);
CREATE INDEX idx_episode_facts_fact ON episode_facts(fact_id);

-- RLS
ALTER TABLE episode_facts ENABLE ROW LEVEL SECURITY;

-- Read: users who can read the episode can read linked facts
CREATE POLICY "Users can view episode facts"
  ON episode_facts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = episode_facts.episode_id
    )
  );

-- Insert: users who can edit the project can link facts
CREATE POLICY "Users can link facts to episodes"
  ON episode_facts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM episodes e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = episode_facts.episode_id
    )
  );

-- Delete: users who can edit the project can unlink facts
CREATE POLICY "Users can unlink facts from episodes"
  ON episode_facts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = episode_facts.episode_id
    )
  );

-- Service role full access
CREATE POLICY "Service role manages episode facts"
  ON episode_facts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE episode_facts IS
  'FILM-1142: Junction table linking verified facts to episodes for Canon Dashboard.';
