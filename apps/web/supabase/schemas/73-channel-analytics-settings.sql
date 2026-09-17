-- ==================================
-- Channel Analytics Settings (FILM-1608)
-- ==================================
-- Per-channel overrides for the YPP gate. A null target means inherit from
-- `analytics_settings` (67); resolution is channel -> account -> default, in
-- one pure function (`@kit/content-analytics` lib/ypp-targets.ts), never in a
-- `??` at the call site.
--
-- Authorisation is `has_account_access` for read and write, matching the other
-- analytics tables rather than `platform_connections`' `has_role_on_account`.
-- The reasoning is recorded in migration 20260916073206_ypp-targets-settings.sql.

create table if not exists public.channel_analytics_settings (
  connection_id uuid primary key,
  account_id uuid not null
    references public.accounts(id) on delete cascade,
  -- Nullable with no default: `null` means inherit. A default here would make
  -- every channel opt out of account settings the moment its row was created.
  ypp_target_watch_hours integer,
  ypp_target_subscribers integer,
  ypp_applicant_status varchar(20) not null default 'unknown',
  joined_ypp_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_analytics_settings_status_check
    check (ypp_applicant_status in ('unknown', 'new_applicant', 'existing_partner')),
  -- Denominators, so zero is not a legal target — see 67 and the
  -- 20260916130805 migration.
  constraint channel_analytics_settings_watch_hours_positive
    check (ypp_target_watch_hours is null or ypp_target_watch_hours > 0),
  constraint channel_analytics_settings_subscribers_positive
    check (ypp_target_subscribers is null or ypp_target_subscribers > 0),
  -- Composite, not `connection_id references platform_connections(id)`. The
  -- policies authorise on the denormalised `account_id`, and a foreign key
  -- check does not run RLS — so with a single-column key a member of one
  -- account could file a row against another account's connection under
  -- their own account_id. `connection_id` is the primary key, so that row
  -- squats the slot and the real owner's upsert fails forever, with no
  -- delete grant to clear it. This makes the pair consistent by
  -- construction, for every writer including service_role.
  constraint channel_analytics_settings_connection_account_fkey
    foreign key (connection_id, account_id)
    references public.platform_connections (id, account_id)
    on delete cascade
);

comment on table public.channel_analytics_settings is
  'Per-channel analytics overrides (YPP targets, applicant status). Null target means inherit from analytics_settings.';

alter table public.channel_analytics_settings enable row level security;

revoke all on public.channel_analytics_settings from authenticated, service_role;
grant select, insert, update on public.channel_analytics_settings to authenticated;
grant select, insert, update, delete on public.channel_analytics_settings to service_role;

-- No delete policy and no delete grant for `authenticated`: reset-to-default
-- writes null, it never deletes the row. Same as `analytics_settings`.
create policy "channel_analytics_settings_read" on public.channel_analytics_settings for select
  to authenticated using (public.has_account_access(account_id));

create policy "channel_analytics_settings_insert" on public.channel_analytics_settings for insert
  to authenticated with check (public.has_account_access(account_id));

create policy "channel_analytics_settings_update" on public.channel_analytics_settings for update
  to authenticated
  using (public.has_account_access(account_id))
  with check (public.has_account_access(account_id));

create index if not exists idx_channel_analytics_settings_account
  on public.channel_analytics_settings(account_id);

create trigger set_channel_analytics_settings_timestamp
  before update on public.channel_analytics_settings
  for each row
  execute function public.trigger_set_timestamps();
