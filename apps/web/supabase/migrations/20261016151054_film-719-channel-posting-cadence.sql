-- FILM-719. Each channel posts on its own cadence.
--
-- A release scheduled 15 minutes apart put an episode's long video and all
-- of its Shorts on a channel within hours, and nothing looked at what other
-- episodes already had queued there: the burst platforms read as
-- mass-produced. A channel now has posting slots, and a release takes the
-- channel's free ones.
--
-- channel_posting_cadences holds a channel's rule, one row per content type;
-- a channel with none posts on the defaults in
-- packages/features/publishing/src/lib/cadence/cadence.ts. publishes gains
-- the slot a post holds and whether it waits for its episode's long video.

create table public.channel_posting_cadences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform_connection_id uuid not null,
  content_type text not null check (content_type in ('full', 'short')),
  -- IANA zone; validated by the app, which falls back to UTC on one it
  -- cannot read
  timezone text not null default 'UTC'
    check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'),
  -- Wall-clock 'HH:MM' times; how many there are is the daily cap
  slot_times text[] not null
    check (cardinality(slot_times) between 1 and 6
       and array_to_string(slot_times, ',')
             ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'),
  -- 0 = Sunday … 6 = Saturday
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}'
    check (cardinality(days_of_week) between 1 and 7
       and days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[]),
  min_days_between smallint not null default 0
    check (min_days_between between 0 and 30),
  start_after_hours smallint not null default 0
    check (start_after_hours between 0 and 168),
  jitter_minutes smallint not null default 20
    check (jitter_minutes between 0 and 120),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_posting_cadences_channel_type_key
    unique (platform_connection_id, content_type),
  -- The account written is the account that owns the channel, for every
  -- writer (20260916180412)
  constraint channel_posting_cadences_connection_account_fkey
    foreign key (platform_connection_id, account_id)
    references public.platform_connections (id, account_id)
    on delete cascade
);

comment on table public.channel_posting_cadences is
  'When a channel posts each content type: slots in its timezone (their count is the daily cap), weekdays, spacing. No row: the defaults. FILM-719';

create index idx_channel_posting_cadences_account
  on public.channel_posting_cadences (account_id);

alter table public.channel_posting_cadences enable row level security;

revoke all on public.channel_posting_cadences from anon, authenticated, service_role;
grant select, insert, update, delete on public.channel_posting_cadences to authenticated;
grant select, insert, update, delete on public.channel_posting_cadences to service_role;

-- As channel_analytics_settings: anyone on the team reads and sets a
-- channel's settings. Deleting a row returns the channel to the defaults.
create policy channel_posting_cadences_read on public.channel_posting_cadences
  for select to authenticated
  using (public.has_account_access(account_id));

create policy channel_posting_cadences_insert on public.channel_posting_cadences
  for insert to authenticated
  with check (public.has_account_access(account_id));

create policy channel_posting_cadences_update on public.channel_posting_cadences
  for update to authenticated
  using (public.has_account_access(account_id))
  with check (public.has_account_access(account_id));

create policy channel_posting_cadences_delete on public.channel_posting_cadences
  for delete to authenticated
  using (public.has_account_access(account_id));

create trigger channel_posting_cadences_set_timestamps
  before insert or update on public.channel_posting_cadences
  for each row execute function public.trigger_set_timestamps();

-- KB-99: a workspace table belongs to a team account
create trigger require_team_account
  before insert or update of account_id on public.channel_posting_cadences
  for each row execute function kit.require_team_account();

-- ----------------------------------------------------------------------
-- publishes: the slot a post holds
-- ----------------------------------------------------------------------
alter table public.publishes
  add column slot_at timestamptz,
  add column after_episode_full boolean not null default false;

comment on column public.publishes.slot_at is
  'The channel slot this post holds; scheduled_at is the slot plus jitter. Null: scheduled by hand, or not scheduled. FILM-719';
comment on column public.publishes.after_episode_full is
  'A Short that goes out only once its episode''s long video is published. FILM-719';

-- One post per slot on a channel. Two releases planned at the same moment
-- cannot both take it: the second insert fails and is planned again. A
-- failed or held post gives its slot back.
create unique index publishes_channel_slot_key
  on public.publishes (platform_connection_id, slot_at)
  where slot_at is not null
    and status in ('scheduled', 'queued', 'publishing', 'published');

-- What is on a channel's calendar, read for every release
create index idx_publishes_channel_scheduled
  on public.publishes (platform_connection_id, scheduled_at)
  where status in ('scheduled', 'queued', 'publishing');
