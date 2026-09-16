-- ==================================
-- YPP Targets & Analytics Settings (FILM-1608)
-- ==================================
-- `analytics_settings` shipped in 20260827101334 with two readers and zero
-- writers, so its fallbacks (`?? 4000`, `?? 1000`, `?? 5`) have fired in every
-- environment since. This migration builds the storage half of the writer.
--
-- Authorisation uses `public.has_account_access(account_id)` for read *and*
-- write, deliberately and not by copy-paste. Three reasons, recorded here so
-- the next reader does not have to re-derive them:
--
--   1. `has_role_on_account(id)` with no role argument is also "any member" —
--      it is not the stricter option it looks like. Restricting writes to
--      owners would need `has_role_on_account(id, 'owner')`, which is a
--      different decision from the one this table is making.
--   2. Every analytics table (66, 67, 68, 69, 71) uses `has_account_access`.
--      `platform_connections` (32) uses `has_role_on_account`; this row is
--      analytics configuration, so it follows the analytics neighbours.
--   3. `analytics_settings` already lets any member write the account-wide
--      target. A per-channel override stricter than the account value it
--      overrides would be incoherent — a member could move the bar for every
--      channel at once but not for one.

-- ----------------------------------
-- 1. The account row learns to say "no value"
-- ----------------------------------
-- The three integer columns were `not null default 4000/1000/5`. A nullable
-- override column is how a channel says "inherit"; the account row needs the
-- same vocabulary to say "fall through to the shipped default", or the two
-- levels behave differently and `basis` cannot be reported honestly.
--
-- Safe without a backfill: the table has never had a writer, so it is empty in
-- every environment. Both existing readers already spell the fallback `??`,
-- which treats null and absent alike, so they are correct either side of this.

alter table public.analytics_settings
  alter column ypp_target_watch_hours drop not null,
  alter column ypp_target_watch_hours drop default,
  alter column ypp_target_subscribers drop not null,
  alter column ypp_target_subscribers drop default,
  alter column tag_min_sample drop not null,
  alter column tag_min_sample drop default;

-- `analytics_settings` was created without a timestamp trigger, so its
-- `updated_at` has only ever been the insert default. Fixing it here rather
-- than asking every future writer to remember: the rule belongs in one place.
drop trigger if exists set_analytics_settings_timestamp on public.analytics_settings;

create trigger set_analytics_settings_timestamp
  before update on public.analytics_settings
  for each row
  execute function public.trigger_set_timestamps();

-- ----------------------------------
-- 2. Per-channel overrides
-- ----------------------------------
-- YPP is a per-channel gate. FILM-1602 made watch hours per-channel because
-- pooling two channels against one 4,000-hour target reports a threshold as
-- met when neither channel has met it — but the target itself stayed
-- account-wide, so a channel on a different tier, a channel already in the
-- programme and a brand-new channel were all measured against one bar.

create table if not exists public.channel_analytics_settings (
  -- `connection_id` is the whole primary key, with no separate `id`: one row
  -- per channel by construction, so an upsert cannot create a second
  -- conflicting override. `analytics_settings` sets the precedent by keying
  -- on `account_id`.
  connection_id uuid primary key
    references public.platform_connections(id) on delete cascade,
  -- Denormalised so RLS reads `has_account_access(account_id)` directly
  -- instead of joining through `platform_connections` on every row.
  account_id uuid not null
    references public.accounts(id) on delete cascade,
  -- Nullable with no default, and that is load-bearing. `null` means inherit
  -- from the account row. A column given `default 4000` would make every
  -- channel permanently opt out of account settings the moment its row was
  -- created, which is the opposite of what an override table is for.
  ypp_target_watch_hours integer,
  ypp_target_subscribers integer,
  -- `not null` because "unknown" is a real value here rather than an absence.
  ypp_applicant_status varchar(20) not null default 'unknown',
  -- Lets a channel already in the programme stop rendering progress toward a
  -- gate it has passed.
  joined_ypp_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_analytics_settings_status_check
    check (ypp_applicant_status in ('unknown', 'new_applicant', 'existing_partner'))
);

comment on table public.channel_analytics_settings is
  'Per-channel analytics overrides (YPP targets, applicant status). Null target means inherit from analytics_settings.';

alter table public.channel_analytics_settings enable row level security;

revoke all on public.channel_analytics_settings from authenticated, service_role;
grant select, insert, update on public.channel_analytics_settings to authenticated;
grant select, insert, update, delete on public.channel_analytics_settings to service_role;

-- No delete policy and no delete grant for `authenticated`, matching
-- `analytics_settings`. Reset-to-default is writing null, never deleting the
-- row, so both tables behave the same way.
create policy "channel_analytics_settings_read" on public.channel_analytics_settings for select
  to authenticated using (public.has_account_access(account_id));

create policy "channel_analytics_settings_insert" on public.channel_analytics_settings for insert
  to authenticated with check (public.has_account_access(account_id));

-- `with check` is spelled out rather than left to Postgres' rule that a bare
-- `using` doubles as the check. The two are equivalent; the explicit form is
-- here so the write branch is visible to a reader.
--
-- It is NOT what stops a cross-tenant repoint, and saying otherwise would be
-- the kind of confident, wrong claim that cost FILM-1609 a review round.
-- Measured on this migration: widening this `with check` to `true` leaves the
-- pgTAP suite entirely green, because Postgres also applies the SELECT policy
-- to the row an UPDATE produces and `channel_analytics_settings_read` tests
-- `has_account_access` on the new `account_id`. Widening the read policy as
-- well turns the repoint case red. The read policy is the guard; this clause
-- is documentation that happens to be enforced.
create policy "channel_analytics_settings_update" on public.channel_analytics_settings for update
  to authenticated
  using (public.has_account_access(account_id))
  with check (public.has_account_access(account_id));

-- Every foreign key is indexed (constitution 3.3). `connection_id` already has
-- one as the primary key; the settings page reads by account, not by channel.
create index if not exists idx_channel_analytics_settings_account
  on public.channel_analytics_settings(account_id);

create trigger set_channel_analytics_settings_timestamp
  before update on public.channel_analytics_settings
  for each row
  execute function public.trigger_set_timestamps();
