-- ==================================
-- Generation runs (FILM-1903, part A: the database)
-- ==================================
-- Every stage execution, in either mode, becomes a row in generation_runs
-- with a mode fixed at creation ('server' = Gemini in the worker, 'external'
-- = an MCP client such as Claude writes), a lease, the target version it was
-- briefed on and its origin. Parts an external agent submits wait in
-- generation_run_parts until finalize; every commit snapshots what it
-- replaced into content_revisions. account_ai_settings holds the team's mode
-- policy, read by openRun (FILM-1910 owns the UI).
--
-- Part A creates the tables, columns, locks, RLS and the restore function.
-- The application code (openRun, run.dispatch, the worker loading a run by
-- id) is part B, on top of FILM-1901's package; tightening run_id to NOT
-- NULL is part C, once every LLM path writes a run.
--
-- Design: specs/phase-19-dual-ai-mcp/EDD.md, "2. Generation runs and
-- leases", "6. One door to AI models", "Database changes".
-- Tests: tests/database/generation-runs.test.sql.

-- ----------------------------------------------------------------------
-- generation_runs
-- ----------------------------------------------------------------------
-- TEXT with CHECK rather than Postgres enums, matching generation_jobs.
-- `stage` is the FILM-1901 registry: a key added there is added here.
create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  target_type text not null
    check (target_type in ('episode', 'scene', 'asset', 'season', 'publish')),
  target_id uuid not null,
  stage text not null
    check (stage in (
      'season_outline', 'season_analysis', 'ideation', 'story',
      'story_refinement', 'screenplay', 'screenplay_refinement', 'shots',
      'audio_cues', 'dialogue_translation', 'asset_description',
      'fact_extraction', 'episode_summary', 'publish_metadata'
    )),
  mode text not null check (mode in ('server', 'external')),
  status text not null default 'briefed'
    check (status in ('briefed', 'in_progress', 'committed', 'failed', 'cancelled', 'expired')),
  lease_expires_at timestamptz,
  target_version integer,
  brief_hash text,
  prompt_slug text,
  prompt_version integer,
  origin jsonb not null default '{}'::jsonb,
  -- FK to mcp_connections added once FILM-1904 lands (built in parallel)
  connection_id uuid,
  job_id uuid references public.generation_jobs(id) on delete set null,
  parent_run_id uuid references public.generation_runs(id) on delete set null,
  error jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  -- a run opened from an MCP connection is always external
  constraint mcp_runs_are_external check (connection_id is null or mode = 'external')
);

comment on table public.generation_runs is
  'One stage execution, in server mode (Gemini in the worker) or external mode (an MCP client writes). FILM-1903';
comment on column public.generation_runs.mode is
  'Fixed at creation by openRun: server or external. Never updated';
comment on column public.generation_runs.status is
  'briefed -> in_progress -> committed | failed | cancelled | expired';
comment on column public.generation_runs.lease_expires_at is
  'Renewed by every call on the run; expire_generation_runs() marks a run past it expired';
comment on column public.generation_runs.target_version is
  'episodes.version when the run was briefed; finalize refuses with TARGET_CHANGED if it moved';
comment on column public.generation_runs.connection_id is
  'The mcp_connections row the run was opened from (FILM-1904); foreign key added once that table exists';
comment on column public.generation_runs.parent_run_id is
  'The run whose commit opened this one (shots -> audio_cues); a child inherits its parent''s mode';
comment on column public.generation_runs.finalized_at is
  'When the run reached a terminal status';

-- one open run per target and stage, whichever mode holds it
create unique index generation_runs_one_open
  on public.generation_runs (target_type, target_id, stage)
  where status in ('briefed', 'in_progress');

create index idx_generation_runs_account on public.generation_runs (account_id, created_at desc);
create index idx_generation_runs_target on public.generation_runs (target_type, target_id);
create index idx_generation_runs_open_lease on public.generation_runs (lease_expires_at)
  where status in ('briefed', 'in_progress');

-- ----------------------------------------------------------------------
-- generation_run_parts
-- ----------------------------------------------------------------------
create table public.generation_run_parts (
  run_id uuid not null references public.generation_runs(id) on delete cascade,
  part_key text not null,
  output jsonb not null,
  validation jsonb,
  submitted_at timestamptz not null default now(),
  primary key (run_id, part_key)
);

comment on table public.generation_run_parts is
  'Parts an external agent submitted, validated, waiting for finalize. Resubmitting a part replaces it. FILM-1903';
comment on column public.generation_run_parts.part_key is
  'reel_scout, scene:4, ... as the stage''s parts() names them';

-- ----------------------------------------------------------------------
-- content_revisions
-- ----------------------------------------------------------------------
create table public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  target_type text not null
    check (target_type in ('episode', 'scene', 'asset', 'season', 'publish')),
  target_id uuid not null,
  stage text not null,
  run_id uuid references public.generation_runs(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.content_revisions is
  'What a commit replaced, so it can be restored. run_id is null for a revision written by restore_content_revision itself. FILM-1903';
comment on column public.content_revisions.snapshot is
  'episode target: {"episode": {story_data, screenplay_data, shot_list, metadata, status, generation_origin}, "shots": [to_jsonb(row)], "dialogue_lines": [...], "audio_cues": [...]}; asset target: {"asset": {description, metadata, generation_origin}}. Every key optional; only present keys are restored';

create index idx_content_revisions_target
  on public.content_revisions (target_type, target_id, created_at desc);
create index idx_content_revisions_run on public.content_revisions (run_id)
  where run_id is not null;

-- ----------------------------------------------------------------------
-- account_ai_settings
-- ----------------------------------------------------------------------
create table public.account_ai_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  server_generation_enabled boolean not null default true,
  external_generation_enabled boolean not null default true,
  default_mode text not null default 'server' check (default_mode in ('server', 'external')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_ai_settings is
  'Team-level mode policy read by openRun; a team with no row has the defaults. FILM-1903 (UI: FILM-1910)';

-- ----------------------------------------------------------------------
-- Additive columns
-- ----------------------------------------------------------------------
-- generation_origin: {kind, runId, model, promptSlug, promptVersion,
-- clientName, at}, stamped by every commit. Null means written before
-- FILM-1903 or by hand.
alter table public.shots add column generation_origin jsonb;
alter table public.dialogue_lines add column generation_origin jsonb;
alter table public.audio_cues add column generation_origin jsonb;
alter table public.assets add column generation_origin jsonb;
-- story and screenplay live in JSONB columns on episodes, so the origin is
-- keyed by stage: {"story": {...}, "screenplay": {...}}
alter table public.episodes add column generation_origin jsonb not null default '{}'::jsonb;

comment on column public.shots.generation_origin is
  'Who wrote this: {kind: server|external|human, runId, model, promptSlug, promptVersion, clientName, at}. FILM-1903';
comment on column public.dialogue_lines.generation_origin is
  'Who wrote this: {kind: server|external|human, runId, model, promptSlug, promptVersion, clientName, at}. FILM-1903';
comment on column public.audio_cues.generation_origin is
  'Who wrote this: {kind: server|external|human, runId, model, promptSlug, promptVersion, clientName, at}. FILM-1903';
comment on column public.assets.generation_origin is
  'Who wrote this: {kind: server|external|human, runId, model, promptSlug, promptVersion, clientName, at}. FILM-1903';
comment on column public.episodes.generation_origin is
  'Per stage: {"story": {kind, runId, model, ...}, "screenplay": {...}}. FILM-1903';

-- Nullable in part A: every LLM job and usage row written today carries no
-- run. Part B makes the gateway write one; part C sets NOT NULL.
alter table public.generation_jobs
  add column run_id uuid references public.generation_runs(id) on delete set null;
alter table public.llm_usage_analytics
  add column run_id uuid references public.generation_runs(id) on delete set null;

comment on column public.generation_jobs.run_id is
  'The server-mode run this job executes. Required for LLM job types once part C lands. FILM-1903';
comment on column public.llm_usage_analytics.run_id is
  'The run this model call was made for. Required once part C lands. FILM-1903';

create index idx_generation_jobs_run on public.generation_jobs (run_id) where run_id is not null;
create index idx_llm_usage_analytics_run on public.llm_usage_analytics (run_id) where run_id is not null;

-- ----------------------------------------------------------------------
-- The locks that keep Gemini out of external work
-- ----------------------------------------------------------------------
-- An LLM job, and a model-usage row, can only exist for an open server-mode
-- run. These hold even if application code is wrong. Part A fires them for
-- every row that carries a run id; part C adds NOT NULL so a row cannot
-- avoid them by carrying none.
create or replace function public.assert_server_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.generation_runs r
    where r.id = new.run_id
      and r.mode = 'server'
      and r.status in ('briefed', 'in_progress')
  ) then
    raise exception 'refused: % row for run %: not an open server-mode run',
      tg_table_name, new.run_id;
  end if;

  return new;
end;
$$;

-- The LLM job types, as generation_jobs_job_type_check lists them
-- (20260923025438, plus 'asset_creation' from KB-174, 20261002201125).
-- video, voice, music and sfx are vendor renders, which an external run may
-- legitimately start (FILM-1909).
create trigger generation_jobs_server_run_only
  before insert or update of run_id on public.generation_jobs
  for each row
  when (
    new.run_id is not null
    and new.job_type in (
      'story', 'screenplay', 'shot_list', 'translate-dialogue',
      'audio_cue_generation', 'story-refinement', 'screenplay-refinement',
      'asset_creation'
    )
  )
  execute function public.assert_server_run();

create trigger llm_usage_analytics_server_run_only
  before insert or update of run_id on public.llm_usage_analytics
  for each row
  when (new.run_id is not null)
  execute function public.assert_server_run();

-- ----------------------------------------------------------------------
-- RLS and grants
-- ----------------------------------------------------------------------
-- Reads follow the studio rule (KB-48): has_account_access, so a personal
-- account's owner (who has no membership row) sees their own runs.
-- Writes to runs, parts and revisions are the service role's, or go through
-- SECURITY DEFINER functions that check write permission (part B adds
-- openRun's); no client write policy exists, and no write privilege.
alter table public.generation_runs enable row level security;
alter table public.generation_run_parts enable row level security;
alter table public.content_revisions enable row level security;
alter table public.account_ai_settings enable row level security;

revoke all on public.generation_runs from anon, authenticated;
revoke all on public.generation_run_parts from anon, authenticated;
revoke all on public.content_revisions from anon, authenticated;
revoke all on public.account_ai_settings from anon, authenticated;

grant select on public.generation_runs to authenticated;
grant select on public.generation_run_parts to authenticated;
grant select on public.content_revisions to authenticated;
grant select, insert, update on public.account_ai_settings to authenticated;

grant select, insert, update, delete on public.generation_runs to service_role;
grant select, insert, update, delete on public.generation_run_parts to service_role;
grant select, insert, update, delete on public.content_revisions to service_role;
grant select, insert, update, delete on public.account_ai_settings to service_role;

create policy generation_runs_read on public.generation_runs
  for select to authenticated
  using (public.has_account_access(account_id));

create policy generation_run_parts_read on public.generation_run_parts
  for select to authenticated
  using (
    exists (
      select 1
      from public.generation_runs r
      where r.id = generation_run_parts.run_id
        and public.has_account_access(r.account_id)
    )
  );

create policy content_revisions_read on public.content_revisions
  for select to authenticated
  using (public.has_account_access(account_id));

-- Owners write the team's AI policy; members read it. Not has_permission
-- settings.manage: the member role holds that too (20240319163440).
create policy account_ai_settings_read on public.account_ai_settings
  for select to authenticated
  using (public.has_account_access(account_id));

create policy account_ai_settings_insert on public.account_ai_settings
  for insert to authenticated
  with check (public.has_role_on_account(account_id, 'owner'));

create policy account_ai_settings_update on public.account_ai_settings
  for update to authenticated
  using (public.has_role_on_account(account_id, 'owner'))
  with check (public.has_role_on_account(account_id, 'owner'));

create trigger account_ai_settings_set_timestamps
  before insert or update on public.account_ai_settings
  for each row execute function public.trigger_set_timestamps();

-- ----------------------------------------------------------------------
-- Restoring a revision
-- ----------------------------------------------------------------------
-- Puts a content_revisions snapshot back on its target, after writing what
-- it replaces as a new revision (run_id null) so the restore is itself
-- undoable. SECURITY DEFINER because the caller may lack a write policy on
-- the content tables' rows (the service role writes them); the access check
-- is can_write_project of the target's project, KB-28's rule. The episodes
-- update bumps episodes.version (episodes_increment_version), so an open run
-- briefed before the restore fails finalize with TARGET_CHANGED.
create or replace function public.restore_content_revision(p_revision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rev public.content_revisions;
  v_project_id uuid;
  v_current jsonb;
  v_undo_id uuid;
  v_episode jsonb;
begin
  select * into rev from public.content_revisions where id = p_revision_id;

  if not found then
    raise exception 'revision % does not exist', p_revision_id
      using errcode = 'no_data_found';
  end if;

  if rev.target_type = 'episode' then
    select e.project_id into v_project_id from public.episodes e where e.id = rev.target_id;
  elsif rev.target_type = 'asset' then
    select a.project_id into v_project_id from public.assets a where a.id = rev.target_id;
  else
    raise exception 'a % revision cannot be restored yet', rev.target_type
      using errcode = 'feature_not_supported';
  end if;

  if v_project_id is null then
    raise exception 'the % % of revision % no longer exists',
      rev.target_type, rev.target_id, p_revision_id
      using errcode = 'no_data_found';
  end if;

  if not public.can_write_project(v_project_id) then
    raise exception 'refused: no write access to the project of revision %', p_revision_id
      using errcode = 'insufficient_privilege';
  end if;

  if rev.target_type = 'episode' then
    select jsonb_build_object(
      'episode', jsonb_build_object(
        'story_data', e.story_data,
        'screenplay_data', e.screenplay_data,
        'shot_list', e.shot_list,
        'metadata', e.metadata,
        'status', e.status,
        'generation_origin', e.generation_origin
      ),
      'shots', coalesce((select jsonb_agg(to_jsonb(s)) from public.shots s where s.episode_id = e.id), '[]'::jsonb),
      'dialogue_lines', coalesce((select jsonb_agg(to_jsonb(d)) from public.dialogue_lines d where d.episode_id = e.id), '[]'::jsonb),
      'audio_cues', coalesce((select jsonb_agg(to_jsonb(c)) from public.audio_cues c where c.episode_id = e.id), '[]'::jsonb)
    )
    into v_current
    from public.episodes e
    where e.id = rev.target_id;
  else
    select jsonb_build_object(
      'asset', jsonb_build_object(
        'description', a.description,
        'metadata', a.metadata,
        'generation_origin', a.generation_origin
      )
    )
    into v_current
    from public.assets a
    where a.id = rev.target_id;
  end if;

  -- the undo revision covers exactly what this restore touches: the same
  -- top-level keys, and within episode/asset the same columns
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_current
  from jsonb_each(v_current)
  where rev.snapshot ? key;

  if v_current ? rev.target_type then
    v_current := jsonb_set(v_current, array[rev.target_type], coalesce((
      select jsonb_object_agg(key, value)
      from jsonb_each(v_current -> rev.target_type)
      where (rev.snapshot -> rev.target_type) ? key
    ), '{}'::jsonb));
  end if;

  insert into public.content_revisions (account_id, target_type, target_id, stage, run_id, snapshot)
  values (rev.account_id, rev.target_type, rev.target_id, rev.stage, null, v_current)
  returning id into v_undo_id;

  if rev.target_type = 'episode' then
    v_episode := coalesce(rev.snapshot -> 'episode', '{}'::jsonb);

    -- dialogue_lines reference shots, so they go first and come back last
    if rev.snapshot ? 'dialogue_lines' then
      delete from public.dialogue_lines where episode_id = rev.target_id;
    end if;
    if rev.snapshot ? 'shots' then
      delete from public.shots where episode_id = rev.target_id;
    end if;
    if rev.snapshot ? 'audio_cues' then
      delete from public.audio_cues where episode_id = rev.target_id;
    end if;

    if rev.snapshot ? 'shots' then
      insert into public.shots
      select * from jsonb_populate_recordset(null::public.shots, rev.snapshot -> 'shots');
    end if;
    if rev.snapshot ? 'dialogue_lines' then
      insert into public.dialogue_lines
      select * from jsonb_populate_recordset(null::public.dialogue_lines, rev.snapshot -> 'dialogue_lines');
    end if;
    if rev.snapshot ? 'audio_cues' then
      insert into public.audio_cues
      select * from jsonb_populate_recordset(null::public.audio_cues, rev.snapshot -> 'audio_cues');
    end if;

    -- always an update, so episodes.version moves even for a rows-only restore
    update public.episodes e
    set story_data = case when v_episode ? 'story_data' then v_episode -> 'story_data' else e.story_data end,
        screenplay_data = case when v_episode ? 'screenplay_data' then v_episode -> 'screenplay_data' else e.screenplay_data end,
        shot_list = case when v_episode ? 'shot_list' then v_episode -> 'shot_list' else e.shot_list end,
        metadata = case when v_episode ? 'metadata' then coalesce(v_episode -> 'metadata', '{}'::jsonb) else e.metadata end,
        status = coalesce(v_episode ->> 'status', e.status),
        generation_origin = case when v_episode ? 'generation_origin' then coalesce(v_episode -> 'generation_origin', '{}'::jsonb) else e.generation_origin end
    where e.id = rev.target_id;
  else
    update public.assets a
    set description = case when rev.snapshot -> 'asset' ? 'description' then rev.snapshot -> 'asset' ->> 'description' else a.description end,
        metadata = case when rev.snapshot -> 'asset' ? 'metadata' then rev.snapshot -> 'asset' -> 'metadata' else a.metadata end,
        generation_origin = case when rev.snapshot -> 'asset' ? 'generation_origin' then rev.snapshot -> 'asset' -> 'generation_origin' else a.generation_origin end
    where a.id = rev.target_id;
  end if;

  return v_undo_id;
end;
$$;

revoke all on function public.restore_content_revision(uuid) from public, anon;
grant execute on function public.restore_content_revision(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- Lease expiry (the cron route api/cron/expire-generation-runs)
-- ----------------------------------------------------------------------
-- A forgotten conversation never locks a target: a run past its lease is
-- marked expired, which drops it out of generation_runs_one_open. Service
-- role only; it bypasses RLS, so the function is a plain invoker.
create or replace function public.expire_generation_runs()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.generation_runs
  set status = 'expired',
      error = coalesce(error, '{}'::jsonb) || jsonb_build_object('code', 'LEASE_EXPIRED'),
      finalized_at = now()
  where status in ('briefed', 'in_progress')
    and lease_expires_at is not null
    and lease_expires_at < now();

  get diagnostics n = row_count;

  return n;
end;
$$;

revoke all on function public.expire_generation_runs() from public, anon, authenticated;
grant execute on function public.expire_generation_runs() to service_role;

-- ----------------------------------------------------------------------
-- Realtime: the studio pages show the lease banner and refresh on commit
-- ----------------------------------------------------------------------
alter publication supabase_realtime add table public.generation_runs;

-- ----------------------------------------------------------------------
-- KB-99: workspace tables belong to a team account
-- ----------------------------------------------------------------------
-- The product is team accounts only (a solo user is a team of one). Every
-- table with a foreign key to accounts carries kit.require_team_account or
-- is named in team-accounts-only.test.sql's allow list; these three are
-- workspace tables, so they carry it. The tables are new, so there are no
-- rows to check first. generation_run_parts reaches its account through
-- the run and has no foreign key to accounts.
create trigger require_team_account
  before insert or update of account_id on public.generation_runs
  for each row execute function kit.require_team_account();

create trigger require_team_account
  before insert or update of account_id on public.content_revisions
  for each row execute function kit.require_team_account();

create trigger require_team_account
  before insert or update of account_id on public.account_ai_settings
  for each row execute function kit.require_team_account();
