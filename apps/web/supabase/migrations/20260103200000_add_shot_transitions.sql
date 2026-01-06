-- Add shot_transitions table for video transitions between shots
-- Phase 3: Transitions System
-- Supports industry-standard transitions: cut, fade, dissolve, wipe

CREATE TABLE IF NOT EXISTS shot_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  -- from_shot_id is null for first shot (no incoming transition)
  from_shot_id UUID REFERENCES shots(id) ON DELETE SET NULL,
  to_shot_id UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  -- Transition type: cut (instant), fade, dissolve, wipe_left, wipe_right, crossfade
  transition_type TEXT NOT NULL DEFAULT 'cut',
  -- Duration in seconds (0 for cut, 0.25-2.0 for others)
  duration_seconds NUMERIC(6,3) NOT NULL DEFAULT 0,
  -- Additional parameters (easing, color for fades, wipe direction, etc.)
  parameters JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_shot_transitions_episode_id ON shot_transitions(episode_id);
CREATE INDEX IF NOT EXISTS idx_shot_transitions_to_shot_id ON shot_transitions(to_shot_id);

-- Comment explaining the table
COMMENT ON TABLE shot_transitions IS 'Stores video transition effects between shots for editing studio';
COMMENT ON COLUMN shot_transitions.transition_type IS 'Type: cut, fade, dissolve, wipe_left, wipe_right, crossfade';
COMMENT ON COLUMN shot_transitions.duration_seconds IS 'Transition duration. 0 for cut, 0.25-2.0 for effects.';
COMMENT ON COLUMN shot_transitions.parameters IS 'Additional params: easing curve, fade color, etc.';

-- RLS policies
ALTER TABLE shot_transitions ENABLE ROW LEVEL SECURITY;

-- Allow users to manage transitions for episodes they have access to
CREATE POLICY "Users can view transitions for accessible episodes" ON shot_transitions
  FOR SELECT USING (
    episode_id IN (
      SELECT e.id FROM episodes e
      JOIN projects p ON e.project_id = p.id
      WHERE p.account_id IN (
        SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert transitions for accessible episodes" ON shot_transitions
  FOR INSERT WITH CHECK (
    episode_id IN (
      SELECT e.id FROM episodes e
      JOIN projects p ON e.project_id = p.id
      WHERE p.account_id IN (
        SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update transitions for accessible episodes" ON shot_transitions
  FOR UPDATE USING (
    episode_id IN (
      SELECT e.id FROM episodes e
      JOIN projects p ON e.project_id = p.id
      WHERE p.account_id IN (
        SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete transitions for accessible episodes" ON shot_transitions
  FOR DELETE USING (
    episode_id IN (
      SELECT e.id FROM episodes e
      JOIN projects p ON e.project_id = p.id
      WHERE p.account_id IN (
        SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()
      )
    )
  );
