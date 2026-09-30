-- FILM-101e, FILM-101h, FILM-809, FILM-808, FILM-1003.
--
-- Two guards the specs asked for and nothing created, and the three tables
-- that report history (FILM-809), the insights cache (FILM-808) and
-- validation audit logging (FILM-1003) need.

-- FILM-101e. A CHECK cannot hold the spec's subquery, so a trigger ties
-- character_details.asset_id to an asset of type 'character'. create_character_
-- with_details enforced it only on the RPC path.
create or replace function public.character_details_require_character_asset()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
begin
  if not exists (
    select 1
      from public.assets a
     where a.id = new.asset_id
       and a.type = 'character'
  ) then
    raise exception 'character_details.asset_id must reference an asset of type character'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.character_details_require_character_asset() from public, anon, authenticated;

drop trigger if exists character_details_require_character_asset on public.character_details;

create trigger character_details_require_character_asset
before insert or update of asset_id on public.character_details
for each row execute function public.character_details_require_character_asset();

-- FILM-101h. The spec's duration_seconds > 0 check was never created. A zero
-- or negative duration means "unknown", which the column already spells NULL.
update public.audio_tracks
   set duration_seconds = null
 where duration_seconds <= 0;

alter table public.audio_tracks
  drop constraint if exists audio_tracks_duration_seconds_positive;

alter table public.audio_tracks
  add constraint audio_tracks_duration_seconds_positive
  check (duration_seconds is null or duration_seconds > 0);

-- FILM-809. One row per generated report, so a user can find last week's
-- export instead of regenerating it. The file itself is in storage under
-- storage_path; the signed URL is minted when the row is opened.
create table if not exists public.generated_reports (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  report_type varchar(10) not null,
  file_name text not null,
  storage_path text not null,
  date_range_start date not null,
  date_range_end date not null,
  record_count integer not null,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now() not null,
  check (report_type in ('pdf', 'csv')),
  check (record_count >= 0),
  check (date_range_end >= date_range_start)
);

comment on table public.generated_reports is 'History of analytics reports users generated (FILM-809)';

create index if not exists idx_generated_reports_account_created
  on public.generated_reports(account_id, created_at desc);

alter table public.generated_reports enable row level security;

revoke all on public.generated_reports from authenticated, service_role;
grant select, insert, delete on table public.generated_reports to authenticated;
grant select, insert, update, delete on table public.generated_reports to service_role;

create policy "generated_reports_read" on public.generated_reports
  for select to authenticated using (public.has_account_access(account_id));

create policy "generated_reports_create" on public.generated_reports
  for insert to authenticated with check (public.has_role_on_account(account_id));

create policy "generated_reports_delete" on public.generated_reports
  for delete to authenticated using (public.has_role_on_account(account_id));

-- FILM-808. Insights are a queued LLM job; an identical request inside the
-- window is answered from this table. The handler reads and writes it with the
-- service role, so no client role has a grant.
create table if not exists public.analytics_insights_cache (
  project_id uuid not null references public.projects(id) on delete cascade,
  input_hash text not null,
  insights jsonb not null,
  created_at timestamp with time zone default now() not null,
  primary key (project_id, input_hash)
);

comment on table public.analytics_insights_cache is 'Generated analytics insights, keyed by a hash of the analytics that produced them (FILM-808)';

alter table public.analytics_insights_cache enable row level security;

revoke all on public.analytics_insights_cache from anon, authenticated, service_role;
grant select, insert, update, delete on table public.analytics_insights_cache to service_role;

-- FILM-1003. One row per canon validation, so a run that blocked or warned is
-- on record after the job's log has gone.
create table if not exists public.validation_runs (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  episode_number integer,
  checkpoint varchar(20) not null,
  enforcement varchar(20) not null,
  passed boolean not null,
  summary jsonb not null,
  violations jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default now() not null,
  check (checkpoint in ('STORY', 'SCREENPLAY')),
  check (enforcement in ('strict', 'flexible'))
);

comment on table public.validation_runs is 'Audit log of canon continuity validations (FILM-1003)';

create index if not exists idx_validation_runs_project_created
  on public.validation_runs(project_id, created_at desc);

alter table public.validation_runs enable row level security;

revoke all on public.validation_runs from anon, authenticated, service_role;
grant select on table public.validation_runs to authenticated;
grant select, insert on table public.validation_runs to service_role;

create policy "validation_runs_read" on public.validation_runs
  for select to authenticated using (
    exists (
      select 1
        from public.projects p
       where p.id = validation_runs.project_id
         and public.has_account_access(p.account_id)
    )
  );
