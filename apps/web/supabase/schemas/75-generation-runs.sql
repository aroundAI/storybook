-- ==================================
-- Generation runs (FILM-1903)
-- ==================================
-- Mirrors migrations/20261002201011_film-1903-generation-runs.sql. Schema
-- files are documentation; the database is built from migrations/.
--
-- Every stage execution, in either mode, is a row in generation_runs with a
-- mode fixed at creation ('server' = Gemini in the worker, 'external' = an
-- MCP client writes), a lease, the target version it was briefed on and its
-- origin. Parts an external agent submits wait in generation_run_parts until
-- finalize; every commit snapshots what it replaced into content_revisions.
-- account_ai_settings holds the team's mode policy, read by openRun.
--
-- The additive columns on episodes, shots, dialogue_lines, assets and
-- generation_jobs are in 30-film-studio.sql; llm_usage_analytics.run_id in
-- 24-llm-usage-analytics.sql; audio_cues.generation_origin has no schema
-- file (audio_cues is only in migrations/20260101071824_add_audio_assets.sql).

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- null for a run on the caller's own text (publish_metadata), part B
  project_id uuid references public.projects(id) on delete cascade,
  target_type text not null
    check (target_type in ('episode', 'scene', 'asset', 'season', 'project', 'publish', 'audio_cue')),
  target_id uuid not null,
  -- the FILM-1901 stage registry, plus the server-only keys part B added:
  -- analytics_insights, language_insights and fact_check are model calls with
  -- no content stage, audio_render the worker's ElevenLabs render job
  stage text not null
    check (stage in (
      'season_outline', 'season_analysis', 'ideation', 'story',
      'story_refinement', 'screenplay', 'screenplay_refinement', 'shots',
      'audio_cues', 'dialogue_translation', 'asset_description',
      'fact_extraction', 'episode_summary', 'publish_metadata',
      'analytics_insights', 'language_insights', 'fact_check', 'audio_render'
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
  -- what the run was asked to do (part B): {kind: 'stage', target} for a
  -- registered stage, {kind: 'job', jobType, payload} for a worker job not
  -- yet on the generation core
  input jsonb not null default '{}'::jsonb,
  -- the connection the run was opened from; null once it is deleted (FILM-1904)
  connection_id uuid references public.mcp_connections(id) on delete set null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  parent_run_id uuid references public.generation_runs(id) on delete set null,
  error jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  -- a run opened from an MCP connection is always external
  constraint mcp_runs_are_external check (connection_id is null or mode = 'external')
);

-- one open run per target and stage, whichever mode holds it
create unique index generation_runs_one_open
  on public.generation_runs (target_type, target_id, stage)
  where status in ('briefed', 'in_progress');

create index idx_generation_runs_account on public.generation_runs (account_id, created_at desc);
create index idx_generation_runs_target on public.generation_runs (target_type, target_id);
create index idx_generation_runs_open_lease on public.generation_runs (lease_expires_at)
  where status in ('briefed', 'in_progress');

create table public.generation_run_parts (
  run_id uuid not null references public.generation_runs(id) on delete cascade,
  part_key text not null,
  output jsonb not null,
  validation jsonb,
  submitted_at timestamptz not null default now(),
  primary key (run_id, part_key)
);

create table public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  target_type text not null
    check (target_type in ('episode', 'scene', 'asset', 'season', 'project', 'publish', 'audio_cue')),
  target_id uuid not null,
  stage text not null,
  run_id uuid references public.generation_runs(id) on delete set null,
  -- episode: {"episode": {story_data, screenplay_data, shot_list, metadata, status, generation_origin},
  --           "shots": [to_jsonb(row)], "dialogue_lines": [...], "audio_cues": [...]}
  -- asset:   {"asset": {description, metadata, generation_origin}}
  -- every key optional; restore_content_revision writes only the present ones
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_content_revisions_target
  on public.content_revisions (target_type, target_id, created_at desc);
create index idx_content_revisions_run on public.content_revisions (run_id)
  where run_id is not null;

create table public.account_ai_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  server_generation_enabled boolean not null default true,
  external_generation_enabled boolean not null default true,
  default_mode text not null default 'server' check (default_mode in ('server', 'external')),
  -- FILM-1912: briefs carry past-episode performance; off by default
  performance_context_enabled boolean not null default false,
  -- FILM-2005: Open in Studio and the storybookstudio client; off by default
  desktop_integration_enabled boolean not null default false,
  -- 2026-10-03: USD a UTC day of server-mode LLM spend; null is no cap
  daily_llm_spend_cap_usd numeric(12, 2)
    constraint account_ai_settings_daily_llm_spend_cap_positive
      check (daily_llm_spend_cap_usd is null or daily_llm_spend_cap_usd > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FILM-1910: never both off, and the default is an allowed mode
  constraint account_ai_settings_a_mode_allowed
    check (server_generation_enabled or external_generation_enabled),
  constraint account_ai_settings_default_mode_allowed
    check (
      (default_mode = 'server' and server_generation_enabled)
      or (default_mode = 'external' and external_generation_enabled)
    )
);

create index idx_generation_jobs_run on public.generation_jobs (run_id) where run_id is not null;
create index idx_llm_usage_analytics_run on public.llm_usage_analytics (run_id) where run_id is not null;
create index idx_llm_usage_analytics_account_created
  on public.llm_usage_analytics (account_id, created_at);

-- ----------------------------------------------------------------------
-- The locks that keep Gemini out of external work
-- ----------------------------------------------------------------------
-- A new LLM job or usage row needs an open server-mode run (part C,
-- 20261003155443: required at insert by this trigger, not NOT NULL, so rows
-- written before it keep their null and `on delete set null` still works).
create or replace function public.assert_server_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.run_id is null then
    -- pg_trigger_depth() > 1: the run was deleted and the foreign key's
    -- on delete set null is clearing the column. Anything else is a row
    -- trying to exist without a run.
    if tg_op = 'INSERT' or pg_trigger_depth() = 1 then
      raise exception 'refused: % row without a run: every LLM job and model call belongs to an open server-mode run',
        tg_table_name;
    end if;

    return new;
  end if;

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

-- every job type but the vendor renders (video, voice, music, sfx), which
-- may belong to an external run; a type added later is locked by default
create trigger generation_jobs_server_run_only
  before insert or update of run_id, job_type on public.generation_jobs
  for each row
  when (new.job_type not in ('video', 'voice', 'music', 'sfx'))
  execute function public.assert_server_run();

create trigger llm_usage_analytics_server_run_only
  before insert or update of run_id on public.llm_usage_analytics
  for each row
  execute function public.assert_server_run();

-- ----------------------------------------------------------------------
-- RLS and grants
-- ----------------------------------------------------------------------
-- Reads: has_account_access (the studio rule, KB-48). Writes to runs, parts
-- and revisions: the service role, or SECURITY DEFINER functions that check
-- write permission; no client write policy, no write privilege.
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

-- owners write the team's AI policy; members read it (the member role holds
-- settings.manage too, so has_permission would not be owners-only)
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
-- Functions
-- ----------------------------------------------------------------------
-- restore_content_revision(p_revision_id uuid) returns uuid
--   SECURITY DEFINER; refuses unless can_write_project(target's project).
--   Writes what it replaces as a new revision (run_id null), applies the
--   snapshot's present keys, and the episodes update bumps episodes.version.
--   Returns the undo revision's id. Full body in the migration.
--
-- expire_generation_runs() returns integer
--   service_role only (the cron route api/cron/expire-generation-runs):
--   marks every briefed/in_progress run past lease_expires_at 'expired'
--   with error.code = 'LEASE_EXPIRED', returns the count.
--
-- Part B (20261002205007): the lifecycle functions a run is driven through,
-- all SECURITY DEFINER and gated on can_drive_generation_run(account,
-- project): the service role, or can_write_project of the run's project, or
-- the caller's team membership when the run names no project; a personal
-- account is refused (KB-99).
--
-- can_drive_generation_run(p_account_id uuid, p_project_id uuid) returns boolean
-- open_generation_run(p_account_id, p_target_type, p_target_id, p_stage,
--   p_mode, p_input, p_origin, p_project_id default null, p_target_version,
--   p_prompt_slug, p_prompt_version, p_connection_id, p_parent_run_id,
--   p_created_by) returns jsonb
--   {ok: true, run} or {ok: false, code: 'RUN_IN_PROGRESS', holder} when
--   generation_runs_one_open refuses; created_by is the caller, or
--   p_created_by for the service role (a child run is its parent's user).
-- renew_generation_run_lease(p_run_id uuid) returns jsonb
--   {ok: true, run} with lease_expires_at = now() + 30 min, or {ok: false,
--   code: 'RUN_NOT_OPEN' | 'RUN_NOT_FOUND', run} for a terminal or expired run.
-- transition_generation_run(p_run_id uuid, p_status text, p_error jsonb) returns jsonb
--   in_progress (renews the lease) or a terminal status (sets finalized_at,
--   keeps p_error); a terminal run never moves again (RUN_NOT_OPEN).
-- record_content_revision(p_run_id uuid, p_snapshot jsonb) returns uuid
--   files the snapshot under the run's own account, target and stage.
-- submit_generation_run_part(p_run_id uuid, p_part_key text, p_output jsonb,
--   p_validation jsonb, p_accepted boolean, p_model text) returns jsonb
--   (FILM-1908, migrations/20261003151631): stores a part an external agent
--   submitted; only the opener of an open external run, 1-100 character key,
--   at most 256 KB. Accepted replaces the output and keeps the failures; a
--   rejection is appended to validation.failures (newest 20) and never
--   replaces an accepted output. Renews the lease, moves briefed to
--   in_progress, merges a reported model into origin. {ok: true, run, part}
--   or {ok: false, code: 'RUN_NOT_OPEN' | 'RUN_NOT_FOUND'}.

-- Realtime: the studio pages show the lease banner and refresh on commit
alter publication supabase_realtime add table public.generation_runs;

-- KB-99: workspace tables belong to a team account (team-accounts-only.test.sql
-- requires the guard on every table with a foreign key to accounts)
create trigger require_team_account
  before insert or update of account_id on public.generation_runs
  for each row execute function kit.require_team_account();

create trigger require_team_account
  before insert or update of account_id on public.content_revisions
  for each row execute function kit.require_team_account();

create trigger require_team_account
  before insert or update of account_id on public.account_ai_settings
  for each row execute function kit.require_team_account();

-- ==================================
-- MCP connector monitoring (FILM-1911)
-- ==================================
-- Mirrors migrations/20261003151633_film-1911-mcp-monitoring.sql.
-- The panels the EDD's "Observability" section asks for, read by the super
-- admin's MCP page (apps/web/app/admin/mcp), and the check behind the alert
-- that an external run recorded a model call.
--
-- Panels: SECURITY DEFINER, because mcp_tool_calls is readable only by a
-- team's owners and generation_runs only by its members, and a super admin
-- reads across teams. Each refuses anyone but public.is_super_admin(), which
-- itself requires an aal2 session. They return aggregates only: no account,
-- user, connection or run id leaves them.
--
-- Guard check: plain invoker, service role only, like
-- expire_generation_runs(). The cron route api/cron/external-run-model-calls
-- calls it hourly.
--
-- Tests: tests/database/mcp-monitoring.test.sql; the four panel functions are
-- pinned in definer-functions-inventory.test.sql.

-- p_days is the window, ending now: 1 to 90 days.
create or replace function public.admin_mcp_check_window(p_days integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'refused: MCP monitoring is for super admins'
      using errcode = 'insufficient_privilege';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'the window must be 1 to 90 days, not %', p_days
      using errcode = 'invalid_parameter_value';
  end if;

  return now() - make_interval(days => p_days);
end;
$$;

revoke all on function public.admin_mcp_check_window(integer) from public, anon, authenticated;

-- Calls per tool, errors per tool and p95 duration per tool.
create or replace function public.admin_mcp_tool_stats(p_days integer default 7)
returns table (tool text, calls bigint, errors bigint, p95_ms double precision)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select c.tool,
         count(*),
         count(*) filter (where c.status = 'error'),
         percentile_cont(0.95) within group (order by c.duration_ms)
  from public.mcp_tool_calls c
  where c.created_at >= v_since
  group by c.tool
  order by 2 desc, 1;
end;
$$;

-- Error rate by code: each code's calls over every call in the window.
-- No calls means no rows, not a 0% rate.
create or replace function public.admin_mcp_error_codes(p_days integer default 7)
returns table (error_code text, calls bigint, total_calls bigint, rate double precision)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  with windowed as (
    select c.error_code
    from public.mcp_tool_calls c
    where c.created_at >= v_since
  ),
  total as (select count(*) as n from windowed)
  select w.error_code,
         count(*),
         t.n,
         count(*)::double precision / t.n
  from windowed w
  cross join total t
  where w.error_code is not null
  group by w.error_code, t.n
  order by 2 desc, 1;
end;
$$;

-- Generation runs opened in the window, by mode and status.
create or replace function public.admin_generation_run_stats(p_days integer default 7)
returns table (mode text, status text, runs bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select r.mode, r.status, count(*)
  from public.generation_runs r
  where r.created_at >= v_since
  group by r.mode, r.status
  order by 1, 2;
end;
$$;

-- Runs whose lease expired, per UTC day, every day of the window present
-- (a day with none is a measured 0: expire_generation_runs() stamps every
-- expiry it makes).
create or replace function public.admin_expired_leases_per_day(p_days integer default 7)
returns table (day date, expired bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.admin_mcp_check_window(p_days);
begin
  return query
  select d::date,
         (select count(*)
          from public.generation_runs r
          where r.status = 'expired'
            and (r.finalized_at at time zone 'utc')::date = d::date)
  from generate_series(
    (v_since at time zone 'utc')::date,
    (now() at time zone 'utc')::date,
    interval '1 day'
  ) d
  order by 1;
end;
$$;

revoke all on function public.admin_mcp_tool_stats(integer) from public, anon;
revoke all on function public.admin_mcp_error_codes(integer) from public, anon;
revoke all on function public.admin_generation_run_stats(integer) from public, anon;
revoke all on function public.admin_expired_leases_per_day(integer) from public, anon;
grant execute on function public.admin_mcp_tool_stats(integer) to authenticated;
grant execute on function public.admin_mcp_error_codes(integer) to authenticated;
grant execute on function public.admin_generation_run_stats(integer) to authenticated;
grant execute on function public.admin_expired_leases_per_day(integer) to authenticated;

-- ----------------------------------------------------------------------
-- The guard-failure check
-- ----------------------------------------------------------------------
-- A model-usage row whose run is external means Gemini ran for work an MCP
-- client owns. llm_usage_analytics_server_run_only (FILM-1903) refuses that
-- insert, so this should always be empty; the alert proves it stays so.
-- Ids and times only, never the prompt or the response.
create or replace function public.external_run_model_calls(p_limit integer default 20)
returns table (usage_id uuid, run_id uuid, account_id uuid, created_at timestamptz, total bigint)
language sql
stable
set search_path = ''
as $$
  select u.id, u.run_id, r.account_id, u.created_at, count(*) over ()
  from public.llm_usage_analytics u
  join public.generation_runs r on r.id = u.run_id
  where r.mode = 'external'
  order by u.created_at desc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.external_run_model_calls(integer) from public, anon, authenticated;
grant execute on function public.external_run_model_calls(integer) to service_role;

-- The daily spend cap's read (owner decision 2026-10-03): priced spend of
-- an account's server-mode runs since a time, unpriced calls counted apart.
-- Service role only; the gateway reads it before opening a server run.
create or replace function public.llm_spend_since(
  p_account_id uuid,
  p_since timestamptz
)
returns table (spent_usd numeric, priced_calls integer, unpriced_calls integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    sum(u.total_cost),
    count(u.total_cost)::integer,
    (count(*) - count(u.total_cost))::integer
  from public.llm_usage_analytics u
  join public.generation_runs r on r.id = u.run_id and r.mode = 'server'
  where u.account_id = p_account_id
    and u.created_at >= p_since;
$$;

revoke all on function public.llm_spend_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.llm_spend_since(uuid, timestamptz) to service_role;
