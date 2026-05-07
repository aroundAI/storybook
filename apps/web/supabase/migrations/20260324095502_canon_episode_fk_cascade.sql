
-- Upgrade canon table FKs from NO ACTION → CASCADE/SET NULL on episode delete

-- character_states: episode_id CASCADE
ALTER TABLE character_states DROP CONSTRAINT character_states_episode_id_fkey;
ALTER TABLE character_states ADD CONSTRAINT character_states_episode_id_fkey
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

-- immutable_events: established_in CASCADE
ALTER TABLE immutable_events DROP CONSTRAINT immutable_events_established_in_fkey;
ALTER TABLE immutable_events ADD CONSTRAINT immutable_events_established_in_fkey
  FOREIGN KEY (established_in) REFERENCES episodes(id) ON DELETE CASCADE;

-- narrative_threads: opened_at CASCADE (thread has no meaning without opening episode)
ALTER TABLE narrative_threads DROP CONSTRAINT narrative_threads_opened_at_fkey;
ALTER TABLE narrative_threads ADD CONSTRAINT narrative_threads_opened_at_fkey
  FOREIGN KEY (opened_at) REFERENCES episodes(id) ON DELETE CASCADE;

-- narrative_threads: resolved_at SET NULL (thread survives if resolving episode is deleted)
ALTER TABLE narrative_threads DROP CONSTRAINT narrative_threads_resolved_at_fkey;
ALTER TABLE narrative_threads ADD CONSTRAINT narrative_threads_resolved_at_fkey
  FOREIGN KEY (resolved_at) REFERENCES episodes(id) ON DELETE SET NULL;
