-- Grant execute on get_episode_languages RPC to authenticated and anon roles.
-- Without this, PostgREST RPC calls fail with permission denied, causing
-- the fallback to fetch raw dialogue_lines (1700+ rows capped at 1000 by
-- PostgREST's server limit), which results in inconsistent language badges.
GRANT EXECUTE ON FUNCTION get_episode_languages(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_episode_languages(uuid[]) TO anon;
