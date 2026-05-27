-- Returns distinct (episode_id, language) pairs for a set of episode IDs.
-- Used by the episode list page to show language badges efficiently
-- without fetching all dialogue_lines rows.
CREATE OR REPLACE FUNCTION get_episode_languages(p_episode_ids uuid[])
RETURNS TABLE(episode_id uuid, language text)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT DISTINCT dl.episode_id, dl.language
  FROM dialogue_lines dl
  WHERE dl.episode_id = ANY(p_episode_ids)
  ORDER BY dl.episode_id, dl.language;
$$;
