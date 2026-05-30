-- Performance Audit v2: Batch update RPC for dialogue line timeline planning
-- Replaces N sequential UPDATE queries with a single batch operation
-- Uses SECURITY INVOKER to respect existing RLS policies

CREATE OR REPLACE FUNCTION plan_dialogue_timeline(
  p_updates jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE dialogue_lines dl
  SET
    shot_id = (u->>'shotId')::uuid,
    timeline_start_seconds = (u->>'timelineStartSeconds')::numeric,
    estimated_duration_seconds = (u->>'estimatedDurationSeconds')::numeric
  FROM jsonb_array_elements(p_updates) AS u
  WHERE dl.id = (u->>'id')::uuid;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
