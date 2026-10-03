-- ==================================
-- A stage's commit in one transaction (FILM-1901 criterion 4, FILM-1903)
-- ==================================
-- Every stage's commit() used to perform its side effects as a sequence of
-- PostgREST calls (the episode's JSONB and status, the shots replace, the
-- dialogue rebuild, audio cues, canon tables, assets, generation_jobs
-- bookkeeping), each its own statement: a failure midway left the earlier
-- writes in place. The specs ask for one transaction, with the snapshot of
-- what is replaced in the same transaction.
--
-- Now commit() computes a plan (the ordered writes, as data) and this
-- function applies it:
--
--   apply_generation_commit(p_run_id, p_plan, p_finalize default true)
--
--   1. locks the run row and refuses unless the caller may drive it
--      (can_drive_generation_run, as every run function), the run is open
--      and its lease has not passed (RUN_NOT_OPEN), and an episode target
--      is still at the version the brief saw (TARGET_CHANGED);
--   2. checks the whole plan against an allowlist of tables, operations and
--      columns before writing anything;
--   3. writes the content_revisions snapshot of what the plan replaces, in
--      the shape restore_content_revision reads (an episode target: the
--      restorable episode columns the plan updates, and the shots,
--      dialogue_lines and audio_cues rows when it writes them);
--   4. applies each write, checking that every row it touched belongs to
--      the run's project (and, for an episode target, to that episode);
--   5. moves the run to committed (unless p_finalize is false: a job whose
--      handler commits several times under one run, or works on after its
--      commit, closes the run itself).
--
-- A failure anywhere raises and the whole call rolls back. A step marked
-- {"onError": "skip"} (or a group of steps) runs in a subtransaction: its
-- failure undoes that step alone and is reported in `skipped`, which is how
-- the writes the handlers always treated as non-fatal (canon tables,
-- auto-created assets, generation_jobs bookkeeping) stay non-fatal. A
-- refusal (allowlist, scope, permission) is never skipped.
--
-- SECURITY DEFINER because content writes from an MCP client run as the
-- user, and the commit's authority is the run's: the caller may drive the
-- run, and every row it touches is in the run's project. The allowlist and
-- the scope check are what stand in for RLS here.
--
-- Tests: tests/database/apply-generation-commit.test.sql.

-- ----------------------------------------------------------------------
-- The allowlist: what a commit may write
-- ----------------------------------------------------------------------
-- Derived from the fourteen stage commits in
-- packages/features/generation/src/stages/. `scope` says how a row is tied
-- to the run's project:
--   project      row.project_id is the run's project
--   project_row  row.id is the run's project (projects)
--   episode_row  row.project_id is the run's project; for an episode run,
--                row.id is that episode (episodes)
--   episode      row.episode_id is an episode of the run's project; for an
--                episode run, that episode
--   job          a generation_jobs row on an episode of the run's project;
--                for an episode run, that episode
-- `insert` lists the columns an insert or upsert may set, `update` those an
-- update (or an upsert's conflict update) may set. The column that ties a
-- row to its project is never updatable, so no row can be moved.
create or replace function kit.generation_commit_allowlist()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $json$ {
    "episodes": {"scope": "episode_row", "ops": ["insert", "update"],
      "insert": ["project_id", "season_id", "number", "title", "slug", "description", "status",
                 "story_data", "version", "generation_origin"],
      "update": ["title", "description", "status", "story_data", "screenplay_data", "shot_list",
                 "metadata", "target_duration_seconds", "updated_at", "generation_origin"]},
    "projects": {"scope": "project_row", "ops": ["update"],
      "insert": [], "update": ["metadata"]},
    "assets": {"scope": "project", "ops": ["upsert"],
      "insert": ["project_id", "type", "name", "description", "metadata", "deleted_at", "generation_origin"],
      "update": ["description", "metadata", "deleted_at", "generation_origin"]},
    "shots": {"scope": "episode", "ops": ["insert", "delete"],
      "insert": ["episode_id", "scene_number", "shot_number", "sequence_number", "scene_description",
                 "prompt", "duration_seconds", "camera_direction", "status", "shorts_candidate",
                 "shorts_metadata", "generation_metadata", "transition_type", "frame_strategy",
                 "primary_subject", "first_frame_description", "last_frame_description",
                 "location_area", "location_environment_description", "generation_origin"],
      "update": []},
    "audio_cues": {"scope": "episode", "ops": ["insert", "delete"],
      "insert": ["episode_id", "scene_number", "cue_type", "prompt", "start_offset_seconds",
                 "duration_seconds", "is_loopable", "status", "generation_origin"],
      "update": []},
    "audio_tracks": {"scope": "episode", "ops": ["delete"], "insert": [], "update": []},
    "dialogue_lines": {"scope": "episode", "ops": ["insert", "delete"],
      "insert": ["episode_id", "character_asset_id", "shot_id", "text", "sequence_number",
                 "scene_number", "timeline_start_seconds", "estimated_duration_seconds", "language",
                 "source_dialogue_id", "status", "generation_origin"],
      "update": []},
    "generation_jobs": {"scope": "job", "ops": ["update"],
      "insert": [], "update": ["status", "completed_at", "output_data"]},
    "verified_facts": {"scope": "project", "ops": ["insert"],
      "insert": ["project_id", "claim", "simplified_claim", "category", "source_type",
                 "source_citation", "source_title", "confidence_score", "verification_status",
                 "created_by"],
      "update": []},
    "immutable_events": {"scope": "project", "ops": ["insert", "delete"],
      "insert": ["project_id", "event_type", "event_key", "established_in", "season",
                 "episode_number", "description", "metadata", "created_by"],
      "update": []},
    "character_states": {"scope": "episode", "ops": ["insert", "delete"],
      "insert": ["character_id", "episode_id", "state_type", "state_value", "trigger_event"],
      "update": []},
    "narrative_threads": {"scope": "project", "ops": ["insert", "update", "delete"],
      "insert": ["project_id", "thread_name", "thread_type", "opened_at", "description", "promises",
                 "episodes_touched", "status", "auto_generated"],
      "update": ["status", "episodes_touched", "description", "version", "resolved_at", "payoffs"]},
    "episode_summaries": {"scope": "episode", "ops": ["upsert"],
      "insert": ["episode_id", "plot_summary", "key_events", "character_changes", "sentiment_score",
                 "estimated_tokens", "updated_at"],
      "update": ["plot_summary", "key_events", "character_changes", "sentiment_score",
                 "estimated_tokens", "updated_at"]},
    "world_states": {"scope": "project", "ops": ["insert", "update"],
      "insert": ["project_id", "episode_id", "location", "time_period", "atmosphere",
                 "active_conflicts", "updated_at"],
      "update": ["location", "time_period", "atmosphere", "active_conflicts", "updated_at"]},
    "state_deltas": {"scope": "episode", "ops": ["insert"],
      "insert": ["episode_id", "entity_type", "entity_id", "before_state", "after_state",
                 "change_reason"],
      "update": []}
  } $json$::jsonb
$$;

-- ----------------------------------------------------------------------
-- Checking a plan before anything is written
-- ----------------------------------------------------------------------
create or replace function kit.generation_commit_column_exists(p_table text, p_column text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(p_table))
      and a.attname = split_part(p_column, '->>', 1)
      and a.attnum > 0
      and not a.attisdropped
  )
$$;

create or replace function kit.validate_generation_commit_step(p_step jsonb, p_in_group boolean)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := p_step ->> 'table';
  v_op text := p_step ->> 'op';
  v_rule jsonb;
  v_cols text[];
  v_conflict text[];
  v_bad text;
  v_filter jsonb;
begin
  if jsonb_typeof(p_step) is distinct from 'object' then
    raise exception 'a commit step must be an object' using errcode = 'invalid_parameter_value';
  end if;

  if v_op = 'group' then
    if p_in_group then
      raise exception 'refused: a commit group cannot hold a group' using errcode = 'insufficient_privilege';
    end if;

    if jsonb_typeof(p_step -> 'ops') is distinct from 'array' then
      raise exception 'a commit group needs its ops' using errcode = 'invalid_parameter_value';
    end if;

    perform kit.validate_generation_commit_step(s, true) from jsonb_array_elements(p_step -> 'ops') s;
    return;
  end if;

  v_rule := kit.generation_commit_allowlist() -> v_table;

  if v_table is null or v_rule is null then
    raise exception 'refused: % is not a table a generation commit writes', coalesce(v_table, '(no table)')
      using errcode = 'insufficient_privilege';
  end if;

  if v_op is null or not (v_rule -> 'ops') ? v_op then
    raise exception 'refused: a generation commit does not % %', coalesce(v_op, '(no op)'), v_table
      using errcode = 'insufficient_privilege';
  end if;

  if v_op in ('insert', 'upsert') then
    if jsonb_typeof(p_step -> 'rows') is distinct from 'array' then
      raise exception 'an % on % needs its rows', v_op, v_table using errcode = 'invalid_parameter_value';
    end if;

    select coalesce(array_agg(distinct k), '{}') into v_cols
    from jsonb_array_elements(p_step -> 'rows') r, jsonb_object_keys(r) k;

    select string_agg(c, ', ') into v_bad
    from unnest(v_cols) c where not (v_rule -> 'insert') ? c;

    if v_bad is not null then
      raise exception 'refused: % is not a column a generation commit inserts into %', v_bad, v_table
        using errcode = 'insufficient_privilege';
    end if;

    if v_op = 'upsert' then
      v_conflict := string_to_array(replace(coalesce(p_step ->> 'onConflict', ''), ' ', ''), ',');

      if cardinality(v_conflict) = 0 or '' = any (v_conflict) then
        raise exception 'an upsert on % needs onConflict', v_table using errcode = 'invalid_parameter_value';
      end if;

      select string_agg(c, ', ') into v_bad
      from unnest(v_conflict) c where not (v_rule -> 'insert') ? c;

      if v_bad is not null then
        raise exception 'refused: % is not a conflict column of %', v_bad, v_table
          using errcode = 'insufficient_privilege';
      end if;

      if not coalesce((p_step ->> 'ignoreDuplicates')::boolean, false) then
        select string_agg(c, ', ') into v_bad
        from unnest(v_cols) c where c <> all (v_conflict) and not (v_rule -> 'update') ? c;

        if v_bad is not null then
          raise exception 'refused: % is not a column a generation commit updates in %', v_bad, v_table
            using errcode = 'insufficient_privilege';
        end if;
      end if;
    end if;
  end if;

  if v_op = 'update' then
    if jsonb_typeof(p_step -> 'values') is distinct from 'object' then
      raise exception 'an update on % needs its values', v_table using errcode = 'invalid_parameter_value';
    end if;

    select string_agg(k, ', ') into v_bad
    from jsonb_object_keys(p_step -> 'values') k where not (v_rule -> 'update') ? k;

    if v_bad is not null then
      raise exception 'refused: % is not a column a generation commit updates in %', v_bad, v_table
        using errcode = 'insufficient_privilege';
    end if;

    -- a merge is a top-level jsonb merge (`col || patch`): jsonb columns only
    select string_agg(m, ', ') into v_bad
    from jsonb_array_elements_text(coalesce(p_step -> 'merge', '[]'::jsonb)) m
    where not (p_step -> 'values') ? m
       or not exists (
         select 1 from pg_catalog.pg_attribute a
         where a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(v_table))
           and a.attname = m and a.atttypid = 'jsonb'::regtype
       );

    if v_bad is not null then
      raise exception '% cannot be merged in %: it is not a jsonb column the update sets', v_bad, v_table
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_op in ('update', 'delete') then
    if jsonb_typeof(p_step -> 'match') is distinct from 'array'
       or jsonb_array_length(p_step -> 'match') = 0 then
      raise exception 'refused: % on % needs a filter',
        case v_op when 'update' then 'an update' else 'a delete' end, v_table
        using errcode = 'insufficient_privilege';
    end if;

    for v_filter in select value from jsonb_array_elements(p_step -> 'match') loop
      if not kit.generation_commit_column_exists(v_table, coalesce(v_filter ->> 'column', '')) then
        raise exception '% has no column %', v_table, v_filter ->> 'column'
          using errcode = 'invalid_parameter_value';
      end if;

      if (v_filter ->> 'column') like '%->>%'
         and coalesce(v_filter ->> 'op', '') not in ('eq', 'neq') then
        raise exception 'a json path filter on % compares with eq or neq', v_table
          using errcode = 'invalid_parameter_value';
      end if;

      if coalesce(v_filter ->> 'op', '') not in ('eq', 'neq', 'in', 'is') then
        raise exception 'a filter on % is eq, neq, in or is, not %', v_table, v_filter ->> 'op'
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  end if;

  select string_agg(c, ', ') into v_bad
  from jsonb_array_elements_text(coalesce(p_step -> 'returning', '[]'::jsonb)) c
  where not kit.generation_commit_column_exists(v_table, c) or c like '%->>%';

  if v_bad is not null then
    raise exception '% has no column % to return', v_table, v_bad using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- ----------------------------------------------------------------------
-- References: a later write uses what an earlier one returned
-- ----------------------------------------------------------------------
-- {"$ref": "<key>", "column": "id"} is that column of every row the keyed
-- write returned, as an array ({"one": true}: the first value). {"$union":
-- [a, b, ...]} is the arrays concatenated, each value once, in order.
create or replace function kit.resolve_generation_commit_refs(p_value jsonb, p_results jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_values jsonb;
begin
  if jsonb_typeof(p_value) = 'array' then
    return coalesce((
      select jsonb_agg(kit.resolve_generation_commit_refs(e, p_results) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
    ), '[]'::jsonb);
  end if;

  if jsonb_typeof(p_value) is distinct from 'object' then
    return p_value;
  end if;

  if p_value ? '$ref' then
    if not p_results ? (p_value ->> '$ref') then
      raise exception 'a commit write refers to %, which wrote nothing', p_value ->> '$ref'
        using errcode = 'invalid_parameter_value';
    end if;

    select coalesce(jsonb_agg(r -> (p_value ->> 'column') order by o), '[]'::jsonb) into v_values
    from jsonb_array_elements(p_results -> (p_value ->> '$ref')) with ordinality x(r, o);

    if coalesce((p_value ->> 'one')::boolean, false) then
      return v_values -> 0;
    end if;

    return v_values;
  end if;

  if p_value ? '$union' then
    return coalesce((
      select jsonb_agg(v order by first_seen)
      from (
        select v, min(o1 * 100000 + o2) as first_seen
        from jsonb_array_elements(kit.resolve_generation_commit_refs(p_value -> '$union', p_results))
               with ordinality a(arr, o1),
             jsonb_array_elements(arr) with ordinality b(v, o2)
        group by v
      ) distinct_values
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_object_agg(k, kit.resolve_generation_commit_refs(v, p_results))
    from jsonb_each(p_value) e(k, v)
  ), '{}'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------
-- Filters, as SQL over the plan's own values ($2)
-- ----------------------------------------------------------------------
-- Every value reaches the statement as a parameter; a column becomes an
-- identifier with %I and is typed through jsonb_populate_record, so a
-- filter compares as the column's own type.
create or replace function kit.generation_commit_where(p_table text, p_match jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_filter jsonb;
  v_i integer := 0;
  v_col text;
  v_op text;
  v_typed text;
begin
  for v_filter in select value from jsonb_array_elements(p_match) loop
    v_col := v_filter ->> 'column';
    v_op := v_filter ->> 'op';

    if v_col like '%->>%' then
      v_parts := v_parts || format(
        '(t.%I ->> %L) %s ($2 -> %s ->> ''value'')',
        split_part(v_col, '->>', 1), split_part(v_col, '->>', 2),
        case v_op when 'eq' then '=' else '<>' end, v_i
      );
    elsif v_op = 'is' then
      v_parts := v_parts || format('t.%I is %s', v_col, case jsonb_typeof(v_filter -> 'value')
        when 'null' then 'null'
        when 'boolean' then case when (v_filter ->> 'value')::boolean then 'true' else 'false' end
        else null end);

      if v_parts[array_length(v_parts, 1)] is null then
        raise exception 'an is filter on %.% takes null, true or false', p_table, v_col
          using errcode = 'invalid_parameter_value';
      end if;
    elsif v_op = 'in' then
      v_parts := v_parts || format(
        't.%1$I = any (array(select (jsonb_populate_record(null::public.%2$I, jsonb_build_object(%3$L, x))).%1$I from jsonb_array_elements($2 -> %4$s -> ''value'') x))',
        v_col, p_table, v_col, v_i
      );
    else
      v_typed := format(
        '(jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $2 -> %s -> ''value''))).%I',
        p_table, v_col, v_i, v_col
      );
      v_parts := v_parts || format('t.%I %s %s', v_col, case v_op when 'eq' then '=' else '<>' end, v_typed);
    end if;

    v_i := v_i + 1;
  end loop;

  return array_to_string(v_parts, ' and ');
end;
$$;

-- ----------------------------------------------------------------------
-- Scope: every row a write touched is in the run's project
-- ----------------------------------------------------------------------
create or replace function kit.check_generation_commit_scope(p_table text, p_rows jsonb, p_scope jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind text := kit.generation_commit_allowlist() -> p_table ->> 'scope';
  v_project uuid := (p_scope ->> 'project_id')::uuid;
  v_episode uuid := case when p_scope ->> 'target_type' = 'episode' then (p_scope ->> 'target_id')::uuid end;
  v_outside integer;
begin
  select count(*) into v_outside
  from jsonb_array_elements(p_rows) r
  where not coalesce(case v_kind
    when 'project_row' then (r ->> 'id')::uuid = v_project
    when 'project' then (r ->> 'project_id')::uuid = v_project
    when 'episode_row' then (r ->> 'project_id')::uuid = v_project
      and (v_episode is null or (r ->> 'id')::uuid = v_episode)
    when 'episode' then (v_episode is null or (r ->> 'episode_id')::uuid = v_episode)
      and exists (
        select 1 from public.episodes e
        where e.id = (r ->> 'episode_id')::uuid and e.project_id = v_project
      )
    when 'job' then r ->> 'reference_type' = 'episode'
      and (v_episode is null or (r ->> 'reference_id')::uuid = v_episode)
      and exists (
        select 1 from public.episodes e
        where e.id = (r ->> 'reference_id')::uuid and e.project_id = v_project
      )
    else false
  end, false);

  if v_outside > 0 then
    raise exception 'refused: % % row(s) are outside the run''s %', v_outside, p_table,
      case when v_episode is null then 'project' else 'episode' end
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ----------------------------------------------------------------------
-- One write
-- ----------------------------------------------------------------------
-- Returns the results with this write's (when it has a key): the columns
-- it asked to return, one object per row, in the order written.
create or replace function kit.apply_generation_commit_write(p_step jsonb, p_scope jsonb, p_results jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_table text := p_step ->> 'table';
  v_op text := p_step ->> 'op';
  v_key text := p_step ->> 'key';
  v_payload jsonb;
  v_match jsonb;
  v_cols text[];
  v_collist text;
  v_conflict text[];
  v_set text;
  v_tail text := '';
  v_affected jsonb := '[]'::jsonb;
  v_returning text[];
begin
  -- A write that waits on others: left out when none of them wrote a row
  if p_step ? 'onlyIfRows' and not exists (
    select 1 from jsonb_array_elements_text(p_step -> 'onlyIfRows') k
    where jsonb_array_length(coalesce(p_results -> k, '[]'::jsonb)) > 0
  ) then
    return case when v_key is null then p_results
                else p_results || jsonb_build_object(v_key, '[]'::jsonb) end;
  end if;

  v_match := kit.resolve_generation_commit_refs(coalesce(p_step -> 'match', '[]'::jsonb), p_results);

  if v_op in ('insert', 'upsert') then
    v_payload := kit.resolve_generation_commit_refs(p_step -> 'rows', p_results);

    if jsonb_array_length(v_payload) > 0 then
      select array_agg(distinct k order by k) into v_cols
      from jsonb_array_elements(v_payload) r, jsonb_object_keys(r) k;

      select string_agg(format('%I', c), ', ') into v_collist from unnest(v_cols) c;

      if v_op = 'upsert' then
        v_conflict := string_to_array(replace(p_step ->> 'onConflict', ' ', ''), ',');

        select string_agg(format('%1$I = excluded.%1$I', c), ', ') into v_set
        from unnest(v_cols) c where c <> all (v_conflict);

        v_tail := format(
          ' on conflict (%s) do %s',
          (select string_agg(format('%I', c), ', ') from unnest(v_conflict) c),
          case when coalesce((p_step ->> 'ignoreDuplicates')::boolean, false) or v_set is null
               then 'nothing' else 'update set ' || v_set end
        );
      end if;

      execute format(
        'with w as (insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)%3$s returning t.*) '
        'select coalesce(jsonb_agg(to_jsonb(w)), ''[]''::jsonb) from w',
        v_table, v_collist, v_tail
      ) into v_affected using v_payload;
    end if;
  elsif v_op = 'update' then
    v_payload := kit.resolve_generation_commit_refs(p_step -> 'values', p_results);

    select string_agg(
      case when coalesce(p_step -> 'merge', '[]'::jsonb) ? k
           then format('%1$I = coalesce(t.%1$I, ''{}''::jsonb) || v.%1$I', k)
           else format('%1$I = v.%1$I', k) end,
      ', ') into v_set
    from jsonb_object_keys(v_payload) k;

    execute format(
      'with w as (update public.%1$I as t set %2$s from jsonb_populate_record(null::public.%1$I, $1) as v where %3$s returning t.*) '
      'select coalesce(jsonb_agg(to_jsonb(w)), ''[]''::jsonb) from w',
      v_table, v_set, kit.generation_commit_where(v_table, v_match)
    ) into v_affected using v_payload, v_match;
  elsif v_op = 'delete' then
    execute format(
      'with w as (delete from public.%1$I as t where %2$s returning t.*) '
      'select coalesce(jsonb_agg(to_jsonb(w)), ''[]''::jsonb) from w',
      v_table, kit.generation_commit_where(v_table, v_match)
    ) into v_affected using null::jsonb, v_match;
  end if;

  perform kit.check_generation_commit_scope(v_table, v_affected, p_scope);

  -- KB-105: a write that matched no row is a failure where the commit says so
  if coalesce((p_step ->> 'requireRows')::boolean, false) and jsonb_array_length(v_affected) = 0 then
    raise exception 'COMMIT_NO_ROWS: the % on % matched no row', v_op, v_table
      using errcode = 'no_data_found';
  end if;

  if v_key is null then
    return p_results;
  end if;

  v_returning := array(select jsonb_array_elements_text(coalesce(p_step -> 'returning', '[]'::jsonb)));

  return p_results || jsonb_build_object(v_key, coalesce((
    select jsonb_agg(
      coalesce((select jsonb_object_agg(c, r -> c) from unnest(v_returning) c), '{}'::jsonb)
      order by o)
    from jsonb_array_elements(v_affected) with ordinality x(r, o)
  ), '[]'::jsonb));
end;
$$;

-- ----------------------------------------------------------------------
-- The snapshot of what the plan replaces
-- ----------------------------------------------------------------------
-- In the shape restore_content_revision reads (FILM-1903 part A): for an
-- episode run, {"episode": {column: before}} for each restorable column the
-- plan updates on episodes, and the episode's shots, dialogue_lines and
-- audio_cues rows for each of those tables the plan writes; for an asset
-- run whose asset exists, {"asset": {column: before}}. Null when the plan
-- replaces nothing restorable.
create or replace function kit.generation_commit_snapshot(p_run public.generation_runs, p_ops jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_writes jsonb;
  v_cols text[];
  v_tables text[];
  v_snapshot jsonb := '{}'::jsonb;
  v_row jsonb;
begin
  select coalesce(jsonb_agg(w), '[]'::jsonb) into v_writes
  from jsonb_array_elements(p_ops) s,
       jsonb_array_elements(case when s ->> 'op' = 'group' then s -> 'ops' else jsonb_build_array(s) end) w;

  if p_run.target_type = 'episode' then
    select coalesce(array_agg(distinct k), '{}') into v_cols
    from jsonb_array_elements(v_writes) w, jsonb_object_keys(w -> 'values') k
    where w ->> 'table' = 'episodes' and w ->> 'op' = 'update'
      and k in ('story_data', 'screenplay_data', 'shot_list', 'metadata', 'status', 'generation_origin');

    select coalesce(array_agg(distinct w ->> 'table'), '{}') into v_tables
    from jsonb_array_elements(v_writes) w
    where w ->> 'table' in ('shots', 'dialogue_lines', 'audio_cues');

    if cardinality(v_cols) = 0 and cardinality(v_tables) = 0 then
      return null;
    end if;

    if cardinality(v_cols) > 0 then
      select to_jsonb(e) into v_row from public.episodes e where e.id = p_run.target_id;

      v_snapshot := v_snapshot || jsonb_build_object('episode',
        (select jsonb_object_agg(c, v_row -> c) from unnest(v_cols) c));
    end if;

    if 'shots' = any (v_tables) then
      v_snapshot := v_snapshot || jsonb_build_object('shots', coalesce(
        (select jsonb_agg(to_jsonb(s) order by s.sequence_number) from public.shots s where s.episode_id = p_run.target_id),
        '[]'::jsonb));
    end if;

    if 'dialogue_lines' = any (v_tables) then
      v_snapshot := v_snapshot || jsonb_build_object('dialogue_lines', coalesce(
        (select jsonb_agg(to_jsonb(d) order by d.sequence_number) from public.dialogue_lines d where d.episode_id = p_run.target_id),
        '[]'::jsonb));
    end if;

    if 'audio_cues' = any (v_tables) then
      v_snapshot := v_snapshot || jsonb_build_object('audio_cues', coalesce(
        (select jsonb_agg(to_jsonb(c) order by c.created_at, c.id) from public.audio_cues c where c.episode_id = p_run.target_id),
        '[]'::jsonb));
    end if;

    return v_snapshot;
  end if;

  if p_run.target_type = 'asset' then
    select coalesce(array_agg(distinct k), '{}') into v_cols
    from jsonb_array_elements(v_writes) w,
         lateral (
           select jsonb_object_keys(w -> 'values') k where w ->> 'op' = 'update'
           union
           select jsonb_object_keys(r) from jsonb_array_elements(
             case when w ->> 'op' = 'upsert' then w -> 'rows' else '[]'::jsonb end) r
         ) keys
    where w ->> 'table' = 'assets' and k in ('description', 'metadata', 'generation_origin');

    select to_jsonb(a) into v_row from public.assets a where a.id = p_run.target_id;

    if cardinality(v_cols) = 0 or v_row is null then
      return null;
    end if;

    return jsonb_build_object('asset', (select jsonb_object_agg(c, v_row -> c) from unnest(v_cols) c));
  end if;

  return null;
end;
$$;

revoke all on function kit.generation_commit_allowlist() from public;
revoke all on function kit.generation_commit_column_exists(text, text) from public;
revoke all on function kit.validate_generation_commit_step(jsonb, boolean) from public;
revoke all on function kit.resolve_generation_commit_refs(jsonb, jsonb) from public;
revoke all on function kit.generation_commit_where(text, jsonb) from public;
revoke all on function kit.check_generation_commit_scope(text, jsonb, jsonb) from public;
revoke all on function kit.apply_generation_commit_write(jsonb, jsonb, jsonb) from public;
revoke all on function kit.generation_commit_snapshot(public.generation_runs, jsonb) from public;

-- ----------------------------------------------------------------------
-- apply_generation_commit
-- ----------------------------------------------------------------------
-- Returns {ok: true, run, results, skipped, revision_id}, or {ok: false,
-- code} for RUN_NOT_FOUND, RUN_NOT_OPEN (terminal or past its lease) and
-- TARGET_CHANGED (with current_version), before anything is written.
-- Raises for a caller who may not drive the run and for a plan the
-- allowlist or the scope refuses (insufficient_privilege), and for any
-- write that fails; the whole call then rolls back.
create or replace function public.apply_generation_commit(
  p_run_id uuid,
  p_plan jsonb,
  p_finalize boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.generation_runs;
  v_version integer;
  v_ops jsonb := coalesce(p_plan -> 'ops', '[]'::jsonb);
  v_step jsonb;
  v_write jsonb;
  v_scope jsonb;
  v_results jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_snapshot jsonb;
  v_revision_id uuid;
begin
  if jsonb_typeof(v_ops) is distinct from 'array' then
    raise exception 'a commit plan carries its ops as an array' using errcode = 'invalid_parameter_value';
  end if;

  -- The run row is held for the whole commit: a second commit of the same
  -- run waits here, then finds it committed
  select * into v_run from public.generation_runs where id = p_run_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND');
  end if;

  if not public.can_drive_generation_run(v_run.account_id, v_run.project_id) then
    raise exception 'refused: no write access to run %', p_run_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_run.status not in ('briefed', 'in_progress')
     or (v_run.lease_expires_at is not null and v_run.lease_expires_at < now()) then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_OPEN', 'run', to_jsonb(v_run));
  end if;

  -- TARGET_CHANGED: the episode, locked against edits until this commits,
  -- is still at the version the brief saw
  if v_run.target_type = 'episode' and v_run.target_version is not null then
    select e.version into v_version from public.episodes e where e.id = v_run.target_id for update;

    if found and v_version is distinct from v_run.target_version then
      return jsonb_build_object(
        'ok', false, 'code', 'TARGET_CHANGED',
        'current_version', v_version, 'run', to_jsonb(v_run)
      );
    end if;
  end if;

  -- The whole plan is checked before anything is written
  perform kit.validate_generation_commit_step(s, false) from jsonb_array_elements(v_ops) s;

  if jsonb_array_length(v_ops) > 0 and v_run.project_id is null then
    raise exception 'refused: run % names no project, so its commit writes nothing', p_run_id
      using errcode = 'insufficient_privilege';
  end if;

  v_scope := jsonb_build_object(
    'project_id', v_run.project_id,
    'target_type', v_run.target_type,
    'target_id', v_run.target_id
  );

  v_snapshot := kit.generation_commit_snapshot(v_run, v_ops);

  if v_snapshot is not null then
    insert into public.content_revisions (account_id, target_type, target_id, stage, run_id, snapshot)
    values (v_run.account_id, v_run.target_type, v_run.target_id, v_run.stage, v_run.id, v_snapshot)
    returning id into v_revision_id;
  end if;

  for v_step in select value from jsonb_array_elements(v_ops) loop
    if v_step ->> 'op' = 'group' or v_step ->> 'onError' = 'skip' then
      -- A subtransaction: its failure undoes this step alone
      begin
        if v_step ->> 'op' = 'group' then
          for v_write in select value from jsonb_array_elements(v_step -> 'ops') loop
            v_results := kit.apply_generation_commit_write(v_write, v_scope, v_results);
          end loop;
        else
          v_results := kit.apply_generation_commit_write(v_step, v_scope, v_results);
        end if;
      exception
        when insufficient_privilege then
          raise;
        when others then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'key', v_step ->> 'key',
            'table', v_step ->> 'table',
            'error', sqlerrm
          ));
      end;
    else
      v_results := kit.apply_generation_commit_write(v_step, v_scope, v_results);
    end if;
  end loop;

  if p_finalize then
    update public.generation_runs
    set status = 'committed', finalized_at = now()
    where id = p_run_id
    returning * into v_run;
  end if;

  return jsonb_build_object(
    'ok', true,
    'run', to_jsonb(v_run),
    'results', v_results,
    'skipped', v_skipped,
    'revision_id', v_revision_id
  );
end;
$$;

revoke all on function public.apply_generation_commit(uuid, jsonb, boolean) from public, anon;
grant execute on function public.apply_generation_commit(uuid, jsonb, boolean) to authenticated, service_role;

comment on function public.apply_generation_commit(uuid, jsonb, boolean) is
  'A stage commit in one transaction: run checks (can_drive_generation_run, open, TARGET_CHANGED), the plan against kit.generation_commit_allowlist(), the content_revisions snapshot, every write scoped to the run''s project, then committed. FILM-1901, FILM-1903';
