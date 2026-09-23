-- ==================================
-- Scheduled Reports Table (FILM-809)
-- ==================================
-- Stores scheduled report configurations for automated email delivery

create table if not exists public.scheduled_reports (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,

  -- Report Configuration
  name varchar(255) not null,
  report_type varchar(10) not null default 'pdf',
  frequency varchar(20) not null,

  -- Report Filters
  metrics text[] not null default '{}',
  platforms text[] not null default '{}',
  project_ids uuid[] default null, -- NULL = all projects

  -- Branding
  branding jsonb default null,

  -- Delivery
  recipients text[] not null, -- Email addresses

  -- Schedule Tracking
  next_run_at timestamp with time zone not null,
  last_run_at timestamp with time zone,
  last_run_status varchar(50),
  last_error text,

  -- Status
  is_active boolean default true not null,

  -- Timestamps
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,

  check (report_type in ('pdf', 'csv', 'raw_csv')),
  check (frequency in ('weekly', 'monthly')),
  check (array_length(recipients, 1) > 0)
);

comment on table public.scheduled_reports is 'Scheduled report configurations for automated email delivery';
comment on column public.scheduled_reports.frequency is 'Report frequency: weekly (Mondays) or monthly (1st of month)';
comment on column public.scheduled_reports.metrics is 'Array of metrics to include: views, watchTime, likes, etc.';
comment on column public.scheduled_reports.platforms is 'Array of platforms to include: youtube, tiktok, instagram, facebook';
comment on column public.scheduled_reports.branding is 'Branding options: {logoUrl, primaryColor, companyName}';
comment on column public.scheduled_reports.next_run_at is 'Next scheduled execution time';

-- Indexes
create index if not exists idx_scheduled_reports_account_id
  on public.scheduled_reports(account_id);
create index if not exists idx_scheduled_reports_next_run
  on public.scheduled_reports(next_run_at)
  where is_active = true;
create index if not exists idx_scheduled_reports_active
  on public.scheduled_reports(account_id, is_active)
  where is_active = true;

-- Timestamps trigger
create trigger scheduled_reports_set_timestamps
before insert or update on public.scheduled_reports
for each row execute function public.trigger_set_timestamps();

-- Enable RLS
alter table public.scheduled_reports enable row level security;

-- Revoke default permissions
revoke all on public.scheduled_reports from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.scheduled_reports to authenticated;
grant select, insert, update, delete on table public.scheduled_reports to service_role;

-- RLS Policies
create policy "scheduled_reports_read" on public.scheduled_reports for select
  to authenticated using (
    public.has_role_on_account(account_id)
  );

create policy "scheduled_reports_create" on public.scheduled_reports for insert
  to authenticated with check (
    public.has_role_on_account(account_id)
  );

create policy "scheduled_reports_update" on public.scheduled_reports for update
  to authenticated using (
    public.has_role_on_account(account_id)
  );

create policy "scheduled_reports_delete" on public.scheduled_reports for delete
  to authenticated using (
    public.has_role_on_account(account_id)
  );

-- ==================================
-- Reports Storage Bucket
-- ==================================
-- Private bucket for generated report files (PDF/CSV)

-- CSV or PDF only, 50 MB (KB-55).
insert into
  storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('reports', 'reports', false, 52428800, array['text/csv', 'application/pdf']);

-- Helper function to extract account ID from report path
-- Path format: exports/{timestamp}-{filename} or scheduled/{reportId}/{timestamp}-{filename}
-- For scheduled: account_id is fetched from scheduled_reports table
-- For exports: account_id is the first path segment
create
or replace function kit.get_account_id_from_report_path (path text) returns uuid
set
  search_path = '' as $$
declare
  parts text[];
  report_id uuid;
  account_id uuid;
begin
  parts := string_to_array(path, '/');

  -- Check if it's a scheduled report path (scheduled/{reportId}/...)
  if array_length(parts, 1) >= 2 and parts[1] = 'scheduled' then
    begin
      report_id := parts[2]::uuid;
      select sr.account_id into account_id
      from public.scheduled_reports sr
      where sr.id = report_id;
      return account_id;
    exception when invalid_text_representation then
      return null;
    end;
  end if;

  -- Check if it's an export path (exports/{accountId}/...)
  if array_length(parts, 1) >= 2 and parts[1] = 'exports' then
    begin
      return parts[2]::uuid;
    exception when invalid_text_representation then
      return null;
    end;
  end if;

  return null;
end;
$$ language plpgsql;

grant
execute on function kit.get_account_id_from_report_path (text) to authenticated,
service_role;

-- RLS policy for reports bucket: SELECT
-- Owner or member of the account (KB-56)
create policy reports_select on storage.objects for select
to authenticated
using (
  bucket_id = 'reports'
  and public.has_account_access(kit.get_account_id_from_report_path(name))
);

-- RLS policy for reports bucket: INSERT
-- Owner or member of the account (KB-56)
create policy reports_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reports'
  and public.has_account_access(kit.get_account_id_from_report_path(name))
);

-- RLS policy for reports bucket: DELETE
-- Owner or member of the account (for cleanup). KB-56: has_account_access,
-- not has_role_on_account, which refuses a personal account's owner.
create policy reports_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'reports'
  and public.has_account_access(kit.get_account_id_from_report_path(name))
);
