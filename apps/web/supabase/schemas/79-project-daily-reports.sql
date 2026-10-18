-- FILM-1735. A project's morning report, one per project and day.
-- Built by migrations/20261018060406_film-1735-project-daily-reports.sql;
-- this file mirrors it for reading.

create table public.project_daily_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- The day reported on, in `timezone`
  report_date date not null,
  timezone text not null
    check (length(timezone) <= 64
       and timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'),
  -- sha256 of the digest the text was written from
  digest_hash text not null check (digest_hash ~ '^[0-9a-f]{64}$'),
  body_md text not null check (length(body_md) between 1 and 40000),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 20000),
  -- The model that wrote it, as its client named it
  model text not null check (length(model) between 1 and 200),
  mcp_connection_id uuid references public.mcp_connections(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_daily_reports_project_day_key
    unique (project_id, report_date)
);

comment on table public.project_daily_reports is
  'A project''s morning report, one per project and day: the first save fixes the day''s text, and no one on the team rewrites or deletes it. Written over MCP (save_project_report). FILM-1735';
comment on column public.project_daily_reports.digest_hash is
  'sha256 of the get_daily_digest output the report was written from. FILM-1735';

create index idx_project_daily_reports_account
  on public.project_daily_reports (account_id);

alter table public.project_daily_reports enable row level security;

revoke all on public.project_daily_reports from anon, authenticated, service_role;
grant select, insert on public.project_daily_reports to authenticated;
grant select, insert, update, delete on public.project_daily_reports to service_role;

create policy project_daily_reports_read on public.project_daily_reports
  for select to authenticated
  using (public.has_account_access(account_id));

-- A member saves a report for one of the team's own projects, as themself
create policy project_daily_reports_insert on public.project_daily_reports
  for insert to authenticated
  with check (
    public.has_account_access(account_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.projects p
       where p.id = project_id
         and p.account_id = project_daily_reports.account_id
    )
  );

-- KB-99: a workspace table belongs to a team account
create trigger require_team_account
  before insert or update of account_id on public.project_daily_reports
  for each row execute function kit.require_team_account();
