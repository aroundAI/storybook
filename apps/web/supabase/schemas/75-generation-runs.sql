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
  project_id uuid not null references public.projects(id) on delete cascade,
  target_type text not null
    check (target_type in ('episode', 'scene', 'asset', 'season', 'publish')),
  target_id uuid not null,
  -- the FILM-1901 stage registry
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
  -- FK to mcp_connections added once FILM-1904 lands
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
    check (target_type in ('episode', 'scene', 'asset', 'season', 'publish')),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_generation_jobs_run on public.generation_jobs (run_id) where run_id is not null;
create index idx_llm_usage_analytics_run on public.llm_usage_analytics (run_id) where run_id is not null;

-- ----------------------------------------------------------------------
-- The locks that keep Gemini out of external work
-- ----------------------------------------------------------------------
-- Part A fires them for every row that carries a run id; part C adds NOT
-- NULL on generation_jobs.run_id (LLM job types) and llm_usage_analytics.run_id.
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

-- the LLM job types of generation_jobs_job_type_check plus 'asset_creation'
-- (KB-174, #553); renders (video, voice, music, sfx) may belong to an
-- external run
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
