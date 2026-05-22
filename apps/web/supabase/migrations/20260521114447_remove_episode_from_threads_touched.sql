CREATE OR REPLACE FUNCTION public.remove_episode_from_threads_touched(
  p_episode_id uuid,
  p_project_id uuid
) RETURNS void AS $$
BEGIN
  UPDATE public.narrative_threads
  SET episodes_touched = array_remove(episodes_touched, p_episode_id),
      updated_at = now()
  WHERE project_id = p_project_id
    AND p_episode_id = ANY(episodes_touched);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
