-- ==================================
-- YouTube Reporting API Jobs (FILM-1504)
-- ==================================
-- Tracks bulk report jobs created per YouTube connection. The Reporting API
-- generates daily CSV reports per job; last_report_created_after is the
-- high-water mark for reports.list so already-ingested reports are skipped.

create table if not exists public.youtube_report_jobs (
  id uuid primary key default extensions.uuid_generate_v4(),
  platform_connection_id uuid not null references public.platform_connections(id) on delete cascade,
  report_type_id varchar(100) not null,
  youtube_job_id varchar(255) not null,
  last_report_created_after timestamptz,
  status varchar(20) not null default 'active',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_connection_id, report_type_id),
  check (status in ('active', 'error', 'disabled'))
);

comment on table public.youtube_report_jobs is 'YouTube Reporting API (bulk reports) job registry per connection';
comment on column public.youtube_report_jobs.report_type_id is 'Reporting API report type, e.g. channel_basic_a3, channel_reach_combined_a1';
comment on column public.youtube_report_jobs.last_report_created_after is 'High-water mark for reports.list createdAfter';

create index if not exists idx_youtube_report_jobs_connection
  on public.youtube_report_jobs(platform_connection_id);

-- RLS: account chain via platform_connections.account_id
alter table public.youtube_report_jobs enable row level security;

revoke all on public.youtube_report_jobs from authenticated, service_role;
grant select on public.youtube_report_jobs to authenticated;
grant select, insert, update, delete on public.youtube_report_jobs to service_role;
-- anon kept Supabase's default grant of everything until KB-51.
revoke all on public.youtube_report_jobs from anon;

create policy "youtube_report_jobs_read" on public.youtube_report_jobs for select
  to authenticated using (
    exists (
      select 1
      from public.platform_connections pc
      where pc.id = platform_connection_id
        and public.has_account_access(pc.account_id)
    )
  );
