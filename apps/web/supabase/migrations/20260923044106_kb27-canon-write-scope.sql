/*
 * KB-27: canon writes, and the bulk reset that deletes canon, need the
 * project-write rule.
 *
 * Both functions are SECURITY DEFINER and granted to `authenticated`, so
 * PostgREST exposes them as /rest/v1/rpc/<name> and row-level security does
 * not apply inside them. Before this migration:
 *
 *   commit_canon_changes checked nothing. Any signed-in user could add
 *   permanent canon to any project and overwrite any episode's canon
 *   summary, with project and episode ids that were not even checked
 *   against each other, and every event it wrote had no author.
 *
 *   bulk_reset_episodes_to_stage checked that the episodes belonged to the
 *   account the caller NAMED, never that the caller could act for it, and
 *   skipped soft-deleted episodes in that check while deleting their canon.
 *
 * Both were reproduced as a second real user over PostgREST (FILM-CC-04
 * KB-27). The rule, the owner's decision of 2026-09-23, is KB-28's
 * public.can_write_project: owner, admin or member in project_members.
 * Tests: tests/database/canon-commit-access.test.sql,
 * bulk-reset-access.test.sql, definer-functions-inventory.test.sql.
 */

-- ------------------------------------------------------------------
-- commit_canon_changes
-- ------------------------------------------------------------------
-- Same signature and result. Every refusal (no such episode, an episode of
-- another project, not a writer, not signed in) raises the same 42501, so
-- the call does not reveal which ids exist. No catch-all handler: the old
-- one re-raised everything as P0001, hiding 42501 and 23505, and an error
-- already rolls back the whole call.
create or replace function public.commit_canon_changes(
  p_project_id uuid,
  p_episode_id uuid,
  p_season integer,
  p_episode_number integer,
  p_events jsonb,
  p_episode_summary text,
  p_sentiment_score numeric(3,2)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_events_created integer := 0;
begin
  if v_uid is null
     or not exists (
       select 1 from public.episodes e
       where e.id = p_episode_id and e.project_id = p_project_id
     )
     or not public.can_write_project(p_project_id) then
    raise exception 'No access to this project''s canon' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 0 then
    insert into public.immutable_events (
      project_id, event_type, event_key, description,
      established_in, season, episode_number, created_by
    )
    select
      p_project_id,
      ev->>'type',
      ev->>'eventKey',
      ev->>'description',
      p_episode_id,
      p_season,
      p_episode_number,
      v_uid
    from jsonb_array_elements(p_events) as ev;

    get diagnostics v_events_created = row_count;
  end if;

  -- One statement, so a concurrent metadata write cannot be lost between a
  -- read and this write.
  update public.episodes
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'canonSummary', p_episode_summary,
    'sentimentScore', p_sentiment_score
  )
  where id = p_episode_id;

  return jsonb_build_object(
    'eventsCreated', v_events_created,
    'summaryStored', true
  );
end;
$$;

revoke all on function public.commit_canon_changes(uuid, uuid, integer, integer, jsonb, text, numeric) from public, anon;
grant execute on function public.commit_canon_changes(uuid, uuid, integer, integer, jsonb, text, numeric) to authenticated, service_role;

comment on function public.commit_canon_changes(uuid, uuid, integer, integer, jsonb, text, numeric) is
  'Atomically commits canon changes (immutable events + episode metadata). Requires the episode to be in the project and can_write_project(project); events are authored by the caller.';

-- ------------------------------------------------------------------
-- bulk_reset_episodes_to_stage
-- ------------------------------------------------------------------
-- Only step 1 changes; the rest is the body from
-- 20260608014516_bulk-reset-episodes-rpc.sql. p_account_id stays: the
-- action writes its audit rows under it.
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

-- ------------------------------------------------------------------
-- remove_episode_from_threads_touched
-- ------------------------------------------------------------------
-- Called from the bulk reset above in definer context. It has no access
-- check and is NOT granted to authenticated -- keep it that way: granting it
-- would open a cross-tenant write. Its body already qualifies its table;
-- pin the search_path like every other definer function.
alter function public.remove_episode_from_threads_touched(uuid, uuid) set search_path = '';
