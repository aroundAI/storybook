-- ==================================
-- Generation runs (FILM-1903, part B: what a run carries, and its lifecycle)
-- ==================================
-- Part A gave a run a row; part B makes the application open and drive one,
-- and found four things the row needed:
--
-- 1. `input`: what the run was asked to do. A registered stage's target
--    (the StageDefinition's targetSchema object: an episode id and the
--    feedback, an asset name and its story text) or, for a handler not yet
--    on the generation core, the LLM job it runs ({kind: 'job', jobType,
--    payload}). The worker loads only a run id from SQS, so the run itself
--    must say what to run.
-- 2. Three more stages and two more target types. analytics_insights and
--    language_insights are model calls with no content stage (the spec's
--    "server only, through the gateway"); audio_render is the worker's
--    ElevenLabs render job, which rides the same queue and so needs a run to
--    be loaded by. A render's target is a cue, and the season and analytics
--    jobs' target is the project.
-- 3. `project_id` nullable: publish_metadata translates the caller's own
--    text and names no project (noTenantLlmJobTarget, KB-31).
-- 4. Lifecycle functions. authenticated has no write privilege on
--    generation_runs (part A), and the MCP path never uses the service role
--    on behalf of a user (phase 19 README), so openRun, renewLease, the
--    status transitions and the revision snapshot are SECURITY DEFINER
--    functions gated on can_write_project of the run's project (KB-28), or
--    on the account being the caller's own when there is no project. The
--    service role (the worker) passes the gate; a stranger does not.
--
-- Tests: tests/database/generation-run-lifecycle.test.sql.

-- ----------------------------------------------------------------------
-- What a run carries
-- ----------------------------------------------------------------------
alter table public.generation_runs
  add column input jsonb not null default '{}'::jsonb;

comment on column public.generation_runs.input is
  'What the run was asked to do: {kind: "stage", target} for a registered stage, {kind: "job", jobType, payload} for a worker job not yet on the generation core. FILM-1903 part B';

alter table public.generation_runs alter column project_id drop not null;

comment on column public.generation_runs.project_id is
  'Null for a run on the caller''s own text (publish_metadata), whose account is the caller''s personal account';

alter table public.generation_runs drop constraint generation_runs_target_type_check;
alter table public.generation_runs add constraint generation_runs_target_type_check
  check (target_type in ('episode', 'scene', 'asset', 'season', 'project', 'publish', 'audio_cue'));

alter table public.content_revisions drop constraint content_revisions_target_type_check;
alter table public.content_revisions add constraint content_revisions_target_type_check
  check (target_type in ('episode', 'scene', 'asset', 'season', 'project', 'publish', 'audio_cue'));

alter table public.generation_runs drop constraint generation_runs_stage_check;
alter table public.generation_runs add constraint generation_runs_stage_check
  check (stage in (
    'season_outline', 'season_analysis', 'ideation', 'story',
    'story_refinement', 'screenplay', 'screenplay_refinement', 'shots',
    'audio_cues', 'dialogue_translation', 'asset_description',
    'fact_extraction', 'episode_summary', 'publish_metadata',
    -- server-only model calls with no content stage, and the audio render
    -- job: they have a run so the worker can load them, never a brief
    'analytics_insights', 'language_insights', 'audio_render'
  ));

comment on column public.generation_runs.stage is
  'The FILM-1901 registry key, or one of the server-only keys analytics_insights, language_insights and audio_render, which no StageDefinition serves';

-- ----------------------------------------------------------------------
-- Who may drive a run
-- ----------------------------------------------------------------------
-- The worker is the service role; a user may drive a run on a project they
-- can write to, or on their own account when the run names no project.
create or replace function public.can_drive_generation_run(
  p_account_id uuid,
  p_project_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), current_setting('role', true)) = 'service_role' then
    return true;
  end if;

  if p_project_id is null then
    return auth.uid() is not null and p_account_id = auth.uid();
  end if;

  return public.can_write_project(p_project_id);
end;
$$;

revoke all on function public.can_drive_generation_run(uuid, uuid) from public, anon;
grant execute on function public.can_drive_generation_run(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- open_generation_run: the only constructor
-- ----------------------------------------------------------------------
-- Returns {ok: true, run} or {ok: false, code: 'RUN_IN_PROGRESS', holder}
-- when generation_runs_one_open refuses a second open run on the target and
-- stage: the holder names who has it, so the caller can say so. created_by
-- is the caller; the service role names the user (a child run opened by the
-- worker is its parent's user).
create or replace function public.open_generation_run(
  p_account_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_stage text,
  p_mode text,
  p_input jsonb,
  p_origin jsonb,
  -- null for a run on the caller's own text; defaulted so the generated
  -- client type lets a caller leave it out
  p_project_id uuid default null,
  p_target_version integer default null,
  p_prompt_slug text default null,
  p_prompt_version integer default null,
  p_connection_id uuid default null,
  p_parent_run_id uuid default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.generation_runs;
  v_holder public.generation_runs;
  v_created_by uuid;
begin
  if not public.can_drive_generation_run(p_account_id, p_project_id) then
    raise exception 'refused: no write access to open a % run on this target', p_stage
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(auth.role(), current_setting('role', true)) = 'service_role' then
    v_created_by := p_created_by;
  else
    v_created_by := auth.uid();
  end if;

  if v_created_by is null then
    raise exception 'refused: a run needs the user it is opened for'
      using errcode = 'insufficient_privilege';
  end if;

  if p_parent_run_id is not null and not exists (
    select 1 from public.generation_runs p
    where p.id = p_parent_run_id and p.account_id = p_account_id and p.mode = p_mode
  ) then
    raise exception 'refused: a child run takes its parent''s account and mode'
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.generation_runs (
      account_id, project_id, target_type, target_id, stage, mode, status,
      lease_expires_at, target_version, prompt_slug, prompt_version,
      origin, input, connection_id, parent_run_id, created_by
    ) values (
      p_account_id, p_project_id, p_target_type, p_target_id, p_stage, p_mode, 'briefed',
      now() + interval '30 minutes', p_target_version, p_prompt_slug, p_prompt_version,
      coalesce(p_origin, '{}'::jsonb), coalesce(p_input, '{}'::jsonb), p_connection_id,
      p_parent_run_id, v_created_by
    )
    returning * into v_run;
  exception
    when unique_violation then
      select * into v_holder
      from public.generation_runs r
      where r.target_type = p_target_type
        and r.target_id = p_target_id
        and r.stage = p_stage
        and r.status in ('briefed', 'in_progress')
      limit 1;

      return jsonb_build_object(
        'ok', false,
        'code', 'RUN_IN_PROGRESS',
        'holder', jsonb_build_object(
          'id', v_holder.id,
          'mode', v_holder.mode,
          'status', v_holder.status,
          'created_by', v_holder.created_by,
          'created_at', v_holder.created_at,
          'lease_expires_at', v_holder.lease_expires_at,
          'origin', v_holder.origin
        )
      );
  end;

  return jsonb_build_object('ok', true, 'run', to_jsonb(v_run));
end;
$$;

revoke all on function public.open_generation_run(uuid, text, uuid, text, text, jsonb, jsonb, uuid, integer, text, integer, uuid, uuid, uuid) from public, anon;
grant execute on function public.open_generation_run(uuid, text, uuid, text, text, jsonb, jsonb, uuid, integer, text, integer, uuid, uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- renew_generation_run_lease: every call on a run renews its 30 minutes
-- ----------------------------------------------------------------------
-- Returns {ok: true, run} with the row as it now stands, or {ok: false,
-- code: 'RUN_NOT_OPEN', run} for a run already terminal (committed, failed,
-- cancelled, expired), or whose lease has passed: the server writer reads
-- this answer before its first model call.
create or replace function public.renew_generation_run_lease(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.generation_runs;
begin
  select * into v_run from public.generation_runs where id = p_run_id;

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

  update public.generation_runs
  set lease_expires_at = now() + interval '30 minutes'
  where id = p_run_id
  returning * into v_run;

  return jsonb_build_object('ok', true, 'run', to_jsonb(v_run));
end;
$$;

revoke all on function public.renew_generation_run_lease(uuid) from public, anon;
grant execute on function public.renew_generation_run_lease(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- transition_generation_run: briefed -> in_progress -> a terminal status
-- ----------------------------------------------------------------------
-- A terminal run never moves again (ok: false, RUN_NOT_OPEN): a replayed
-- message for a committed run is a no-op at the application layer, and the
-- database agrees. Moving to in_progress renews the lease; a terminal
-- status sets finalized_at and keeps the error the caller gives.
create or replace function public.transition_generation_run(
  p_run_id uuid,
  p_status text,
  p_error jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.generation_runs;
begin
  if p_status not in ('in_progress', 'committed', 'failed', 'cancelled') then
    raise exception 'a run cannot be moved to %', p_status
      using errcode = 'check_violation';
  end if;

  select * into v_run from public.generation_runs where id = p_run_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND');
  end if;

  if not public.can_drive_generation_run(v_run.account_id, v_run.project_id) then
    raise exception 'refused: no write access to run %', p_run_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_run.status not in ('briefed', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'RUN_NOT_OPEN', 'run', to_jsonb(v_run));
  end if;

  if p_status = 'in_progress' then
    update public.generation_runs
    set status = 'in_progress',
        lease_expires_at = now() + interval '30 minutes'
    where id = p_run_id
    returning * into v_run;
  else
    update public.generation_runs
    set status = p_status,
        error = coalesce(p_error, error),
        finalized_at = now()
    where id = p_run_id
    returning * into v_run;
  end if;

  return jsonb_build_object('ok', true, 'run', to_jsonb(v_run));
end;
$$;

revoke all on function public.transition_generation_run(uuid, text, jsonb) from public, anon;
grant execute on function public.transition_generation_run(uuid, text, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- record_content_revision: what a commit is about to replace
-- ----------------------------------------------------------------------
-- The snapshot follows the contract restore_content_revision reads (part
-- A): an episode target carries {"episode": {...columns}, "shots": [...],
-- ...}, an asset target {"asset": {...columns}}. The run's account, target
-- and stage are copied from the run, so a caller cannot file a revision
-- under another target.
create or replace function public.record_content_revision(
  p_run_id uuid,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.generation_runs;
  v_id uuid;
begin
  select * into v_run from public.generation_runs where id = p_run_id;

  if not found then
    raise exception 'run % does not exist', p_run_id
      using errcode = 'no_data_found';
  end if;

  if not public.can_drive_generation_run(v_run.account_id, v_run.project_id) then
    raise exception 'refused: no write access to run %', p_run_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.content_revisions (account_id, target_type, target_id, stage, run_id, snapshot)
  values (v_run.account_id, v_run.target_type, v_run.target_id, v_run.stage, v_run.id, p_snapshot)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_content_revision(uuid, jsonb) from public, anon;
grant execute on function public.record_content_revision(uuid, jsonb) to authenticated, service_role;
