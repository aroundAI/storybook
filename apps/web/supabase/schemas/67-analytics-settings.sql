-- ==================================
-- Analytics Settings (FILM-1506)
-- ==================================
-- Per-account analytics configuration: YPP gate targets and tag-analysis
-- sample thresholds.
--
-- The three integer columns were `not null default 4000/1000/5` until
-- FILM-1608 (migration 20260916073206) made them nullable with no default.
-- `null` means "fall through to the shipped default", which is the same
-- vocabulary a null override uses in `channel_analytics_settings` (73) — the
-- two levels have to agree or `basis` cannot be reported honestly. The
-- defaults themselves did not move; they live in the resolver.

create table if not exists public.analytics_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  ypp_target_watch_hours integer,
  ypp_target_subscribers integer,
  tag_min_sample integer,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.analytics_settings is 'Per-account analytics configuration (YPP targets, tag sample thresholds)';

alter table public.analytics_settings enable row level security;

revoke all on public.analytics_settings from authenticated, service_role;
grant select, insert, update on public.analytics_settings to authenticated;
grant select, insert, update, delete on public.analytics_settings to service_role;

create policy "analytics_settings_read" on public.analytics_settings for select
  to authenticated using (public.has_account_access(account_id));

create policy "analytics_settings_insert" on public.analytics_settings for insert
  to authenticated with check (public.has_account_access(account_id));

create policy "analytics_settings_update" on public.analytics_settings for update
  to authenticated using (public.has_account_access(account_id));

-- Added by FILM-1608. Without it `updated_at` was only ever the insert
-- default, because this table shipped with no writer to notice.
create trigger set_analytics_settings_timestamp
  before update on public.analytics_settings
  for each row
  execute function public.trigger_set_timestamps();
