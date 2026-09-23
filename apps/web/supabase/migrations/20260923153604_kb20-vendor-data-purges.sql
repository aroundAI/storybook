-- KB-20 item 3 / KB-22 part B: vendor data is deleted by a deliberate,
-- scoped job, never by a cascade.
--
-- A purge removes what one connection's platform gave us — ClickHouse's
-- per-video and per-channel statistics, `revenue_records` with
-- source = 'api', and the YouTube report-job registry — and nothing a person
-- entered. It runs:
--
--   * for YouTube, after a disconnect in the app: YouTube's API policies
--     (III.D, III.E.4) require deletion within 7 calendar days;
--   * when the connection row is deleted, which since KB-22 happens only
--     with its account;
--   * when someone asks (the operator inserts a row — runbook procedure B).
--
-- Other platforms keep their statistics after a disconnect until the
-- creator asks (owner decision, 2026-09-22). The 30-day deletion for a
-- YouTube token that cannot be renewed is deferred until KB-29 lands
-- (owner decision D5): today KB-29 makes renewals fail for our own reasons.

-- ==================================
-- 1. The queue, which is also the audit log
-- ==================================

create table if not exists public.vendor_data_purges (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys: the record outlives the connection and the account
  -- it concerns, because it is the evidence that the deletion happened.
  connection_id uuid not null,
  account_id uuid,
  platform varchar(50) not null,
  reason varchar(30) not null,
  requested_at timestamptz not null default now(),
  run_after timestamptz not null default now(),
  due_by timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  -- Per-table counts, and `clickhouse: 'deleted' | 'disabled'`.
  result jsonb,
  constraint vendor_data_purges_reason_check
    check (reason in ('in_app_disconnect', 'request', 'connection_deleted')),
  constraint vendor_data_purges_window_check check (run_after <= due_by)
);

comment on table public.vendor_data_purges is
  'KB-20/KB-22: one row per deletion of a connection''s vendor-sourced data — the queue the purge job works from, and the record that it was done.';

create index if not exists idx_vendor_data_purges_pending
  on public.vendor_data_purges (run_after)
  where completed_at is null;

create index if not exists idx_vendor_data_purges_connection
  on public.vendor_data_purges (connection_id);

alter table public.vendor_data_purges enable row level security;

revoke all on public.vendor_data_purges from anon, authenticated, service_role;
grant select on public.vendor_data_purges to authenticated;
grant select, insert, update on public.vendor_data_purges to service_role;

-- Members see their own account's purges (the Settings row says when the
-- statistics were deleted). Nobody but the service role writes.
create policy vendor_data_purges_read on public.vendor_data_purges
  for select to authenticated
  using (public.has_account_access(account_id));

-- ==================================
-- 2. What enqueues a purge
-- ==================================

-- A YouTube channel disconnected in the app. `run_after` is an hour out so a
-- sync that read the token just before the disconnect has finished writing
-- before its rows are deleted; the policy window is `due_by`.
create or replace function public.vendor_data_purges_on_disconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.vendor_data_purges
    (connection_id, account_id, platform, reason, run_after, due_by)
  values
    (new.id, new.account_id, new.platform, 'in_app_disconnect',
     now() + interval '1 hour', now() + interval '7 days');

  return new;
end;
$$;

drop trigger if exists vendor_data_purges_on_disconnect on public.platform_connections;

create trigger vendor_data_purges_on_disconnect
after update of disconnected_at on public.platform_connections
for each row
when (
  old.disconnected_at is null
  and new.disconnected_at is not null
  and new.platform = 'youtube'
)
execute function public.vendor_data_purges_on_disconnect();

-- A connection row deleted — since KB-22 only with its account, which is a
-- request to delete everything. Every platform, 7 days (the promise the
-- data-deletion page makes for account deletion).
create or replace function public.vendor_data_purges_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.vendor_data_purges
    (connection_id, account_id, platform, reason, run_after, due_by)
  values
    (old.id, old.account_id, old.platform, 'connection_deleted',
     now(), now() + interval '7 days');

  return old;
end;
$$;

drop trigger if exists vendor_data_purges_on_delete on public.platform_connections;

create trigger vendor_data_purges_on_delete
after delete on public.platform_connections
for each row execute function public.vendor_data_purges_on_delete();

revoke all on function public.vendor_data_purges_on_disconnect() from public, anon, authenticated;
revoke all on function public.vendor_data_purges_on_delete() from public, anon, authenticated;

-- ==================================
-- 3. The Postgres half of a purge, in one transaction
-- ==================================
-- The ClickHouse half is the job's (packages/features/content-analytics/
-- src/server/vendor-data-purge). This removes, for one connection:
--
--   * revenue_records with source = 'api' on its publishes — never 'manual';
--   * its youtube_report_jobs;
--   * publishes.metadata.sync and publishes.duration_seconds, which record
--     what was collected and would stop a reconnect collecting it again;
--   * the vendor's pictures and follower count from the connection's
--     metadata. Its id and name stay (owner decision D3): they label the
--     creator's history and let a reconnect find the row.
--
-- Returns the counts, for `vendor_data_purges.result`.
create or replace function public.purge_connection_vendor_rows(
  p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revenue integer;
  v_report_jobs integer;
  v_publishes integer;
begin
  delete from public.revenue_records r
   using public.publishes p
   where p.id = r.publish_id
     and p.platform_connection_id = p_connection_id
     and r.source = 'api';
  get diagnostics v_revenue = row_count;

  delete from public.youtube_report_jobs
   where platform_connection_id = p_connection_id;
  get diagnostics v_report_jobs = row_count;

  update public.publishes
     set metadata = coalesce(metadata, '{}'::jsonb) - 'sync',
         duration_seconds = null
   where platform_connection_id = p_connection_id
     and (metadata ? 'sync' or duration_seconds is not null);
  get diagnostics v_publishes = row_count;

  update public.platform_connections
     set metadata = coalesce(metadata, '{}'::jsonb)
       - 'thumbnail_url' - 'avatar_url' - 'profile_image_url'
       - 'profile_picture_url' - 'picture' - 'picture_url'
       - 'followers_count'
   where id = p_connection_id;

  return jsonb_build_object(
    'revenue_records_api', v_revenue,
    'youtube_report_jobs', v_report_jobs,
    'publishes_reset', v_publishes
  );
end;
$$;

revoke all on function public.purge_connection_vendor_rows(uuid) from public, anon, authenticated;
grant execute on function public.purge_connection_vendor_rows(uuid) to service_role;
