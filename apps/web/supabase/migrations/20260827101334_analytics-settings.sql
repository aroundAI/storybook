-- ==================================
-- Analytics Settings (FILM-1506)
-- ==================================
-- Per-account analytics configuration: YPP gate targets and tag-analysis
-- sample thresholds.

create table if not exists public.analytics_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  ypp_target_watch_hours integer not null default 4000,
  ypp_target_subscribers integer not null default 1000,
  tag_min_sample integer not null default 5,
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
