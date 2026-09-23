-- =============================================================================
-- Bulk Reset Episodes to Stage
-- =============================================================================
-- Atomically resets multiple episodes to a specified pipeline stage.
-- Replaces the N+1 client-side loop with a single RPC call.
-- Uses SECURITY DEFINER for atomicity. Access: every episode must be in a
-- project of p_account_id that the caller can write (KB-27).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.bulk_reset_episodes_to_stage(
  p_episode_ids UUID[],
  p_target_stage TEXT,  -- 'draft', 'story', 'screenplay', 'storyboard'
  p_account_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reset_count INTEGER := 0;
  v_episode RECORD;
  v_unauthorized_count INTEGER;
BEGIN
  -- Validate target stage
  IF p_target_stage NOT IN ('draft', 'story', 'screenplay', 'storyboard') THEN
    RETURN jsonb_build_object(
      'reset_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('episode_id', NULL, 'error', 'Invalid target stage: ' || p_target_stage)
      )
    );
  END IF;

  -- Empty input short-circuit
  IF array_length(p_episode_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('reset_count', 0, 'errors', '[]'::jsonb);
  END IF;

  -- =========================================================================
  -- 1. Every episode must be in a project of p_account_id that the caller
  --    can write (KB-27). Soft-deleted episodes count: the deletes below do
  --    not filter them, so neither may this check. An id that is not an
  --    episode at all is refused too.
  -- =========================================================================
  SELECT count(*) INTO v_unauthorized_count
  FROM unnest(p_episode_ids) AS ids(id)
  WHERE auth.uid() IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.episodes e
       JOIN public.projects p ON p.id = e.project_id
       WHERE e.id = ids.id
         AND p.account_id = p_account_id
         AND public.can_write_project(p.id)
     );

  IF v_unauthorized_count > 0 THEN
    RETURN jsonb_build_object(
      'reset_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object(
          'episode_id', NULL,
          'error', format('You cannot reset %s of these episodes', v_unauthorized_count)
        )
      )
    );
  END IF;

  -- =========================================================================
  -- 2. Cancel active generation jobs for all episodes
  -- =========================================================================
  UPDATE public.generation_jobs
  SET status = 'failed',
      error_message = 'Cancelled: bulk reset to ' || p_target_stage,
      completed_at = now()
  WHERE reference_id = ANY(p_episode_ids)
    AND reference_type = 'episode'
    AND status IN ('queued', 'processing');

  -- =========================================================================
  -- 3. Stage-specific cleanup
  -- =========================================================================
  IF p_target_stage = 'draft' THEN
    -- Full reset: delete everything downstream

    DELETE FROM public.shots WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.dialogue_lines WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.audio_tracks WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.audio_cues WHERE episode_id = ANY(p_episode_ids);

    -- Canon cleanup
    DELETE FROM public.narrative_threads WHERE opened_at = ANY(p_episode_ids);
    DELETE FROM public.immutable_events WHERE established_in = ANY(p_episode_ids);
    DELETE FROM public.character_states WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.state_deltas WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.episode_summaries WHERE episode_id = ANY(p_episode_ids);

    -- Remove episodes from threads_touched arrays
    FOR v_episode IN
      SELECT e.id, e.project_id
      FROM public.episodes e
      WHERE e.id = ANY(p_episode_ids) AND e.deleted_at IS NULL
    LOOP
      PERFORM public.remove_episode_from_threads_touched(v_episode.id, v_episode.project_id);
    END LOOP;

    -- Update episodes
    UPDATE public.episodes
    SET status = 'draft',
        story_data = NULL,
        screenplay_data = NULL,
        shot_list = NULL,
        updated_at = now()
    WHERE id = ANY(p_episode_ids)
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  ELSIF p_target_stage = 'story' THEN
    -- Keep story_data, clear everything after

    DELETE FROM public.shots WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.dialogue_lines WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.audio_tracks WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.audio_cues WHERE episode_id = ANY(p_episode_ids);

    -- Canon cleanup (same as draft)
    DELETE FROM public.narrative_threads WHERE opened_at = ANY(p_episode_ids);
    DELETE FROM public.immutable_events WHERE established_in = ANY(p_episode_ids);
    DELETE FROM public.character_states WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.state_deltas WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.episode_summaries WHERE episode_id = ANY(p_episode_ids);

    -- Remove episodes from threads_touched arrays
    FOR v_episode IN
      SELECT e.id, e.project_id
      FROM public.episodes e
      WHERE e.id = ANY(p_episode_ids) AND e.deleted_at IS NULL
    LOOP
      PERFORM public.remove_episode_from_threads_touched(v_episode.id, v_episode.project_id);
    END LOOP;

    -- Update episodes (keep story_data)
    UPDATE public.episodes
    SET status = 'draft',
        screenplay_data = NULL,
        shot_list = NULL,
        updated_at = now()
    WHERE id = ANY(p_episode_ids)
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  ELSIF p_target_stage IN ('screenplay', 'storyboard') THEN
    -- Keep story + screenplay + dialogue_lines, clear shots and audio

    DELETE FROM public.audio_cues WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.audio_tracks WHERE episode_id = ANY(p_episode_ids);
    DELETE FROM public.shots WHERE episode_id = ANY(p_episode_ids);

    -- Update episodes
    UPDATE public.episodes
    SET status = 'storyboard',
        shot_list = NULL,
        updated_at = now()
    WHERE id = ANY(p_episode_ids)
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  END IF;

  RETURN jsonb_build_object(
    'reset_count', v_reset_count,
    'errors', '[]'::jsonb
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'reset_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('episode_id', NULL, 'error', SQLERRM)
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_reset_episodes_to_stage(UUID[], TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_reset_episodes_to_stage(UUID[], TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.bulk_reset_episodes_to_stage IS
  'Atomically resets multiple episodes to a specified pipeline stage. Refuses unless every episode is in a project of p_account_id that the caller can write (can_write_project), then cancels active generation jobs and performs stage-specific data cleanup in a single transaction.';
