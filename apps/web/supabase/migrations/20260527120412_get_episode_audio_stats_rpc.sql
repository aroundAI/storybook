-- Returns audio generation stats per episode for the episode list page.
-- Single query aggregates dialogue_lines + audio_cues counts so the UI
-- can show "3/10 🎤  7/7 🎵  5/12 🔊" per episode without N+1 queries.
CREATE OR REPLACE FUNCTION get_episode_audio_stats(p_episode_ids uuid[])
RETURNS TABLE(
  episode_id uuid,
  dialogue_total bigint,
  dialogue_completed bigint,
  music_total bigint,
  music_completed bigint,
  sfx_total bigint,
  sfx_completed bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH dl AS (
    SELECT
      d.episode_id,
      count(*) AS total,
      count(*) FILTER (WHERE d.status = 'completed') AS completed
    FROM dialogue_lines d
    WHERE d.episode_id = ANY(p_episode_ids)
    GROUP BY d.episode_id
  ),
  mc AS (
    SELECT
      c.episode_id,
      count(*) AS total,
      count(*) FILTER (WHERE c.status IN ('placed', 'matched')) AS completed
    FROM audio_cues c
    WHERE c.episode_id = ANY(p_episode_ids)
      AND c.cue_type = 'music'
    GROUP BY c.episode_id
  ),
  sc AS (
    SELECT
      c.episode_id,
      count(*) AS total,
      count(*) FILTER (WHERE c.status IN ('placed', 'matched')) AS completed
    FROM audio_cues c
    WHERE c.episode_id = ANY(p_episode_ids)
      AND c.cue_type IN ('sfx', 'ambient')
    GROUP BY c.episode_id
  )
  SELECT
    e.id AS episode_id,
    COALESCE(dl.total, 0) AS dialogue_total,
    COALESCE(dl.completed, 0) AS dialogue_completed,
    COALESCE(mc.total, 0) AS music_total,
    COALESCE(mc.completed, 0) AS music_completed,
    COALESCE(sc.total, 0) AS sfx_total,
    COALESCE(sc.completed, 0) AS sfx_completed
  FROM unnest(p_episode_ids) AS e(id)
  LEFT JOIN dl ON dl.episode_id = e.id
  LEFT JOIN mc ON mc.episode_id = e.id
  LEFT JOIN sc ON sc.episode_id = e.id
  ORDER BY e.id;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_episode_audio_stats(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_episode_audio_stats(uuid[]) TO anon;
