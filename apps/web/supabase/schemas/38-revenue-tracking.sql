-- ==================================
-- FILM-810: Revenue Tracking Schema
-- ==================================
-- Revenue analytics tables for tracking monetization data across platforms
-- Supports both API-sourced and manually-entered revenue data

-- ==================================
-- Section: Revenue Records Table
-- ==================================
-- Daily revenue data per publish with detailed breakdown

create table if not exists public.revenue_records (
  id uuid primary key default extensions.uuid_generate_v4(),
  publish_id uuid references public.publishes(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  platform varchar(50) not null,
  record_date date not null,
  revenue_cents integer not null default 0,
  currency varchar(3) default 'USD',
  source varchar(20) not null default 'api', -- 'api' or 'manual'
  category varchar(30) not null default 'ads',
  breakdown jsonb default '{}',
  metadata jsonb default '{}',
  -- Who recorded this by hand. Null for sync-written rows, and for rows
  -- predating the column — those stay owner-only, which is the safe way to
  -- be wrong about authorship.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  check (platform in ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin', 'manual')),
  check (source in ('api', 'manual')),
  constraint revenue_records_category_check
    check (category in ('ads', 'premium', 'sponsorship', 'product', 'affiliate', 'licensing', 'other')),
  constraint revenue_records_scope_check
    check (publish_id is not null or account_id is not null)
);

-- Exactly one scope. `scope_check` above requires at least one, which allowed
-- rows carrying both — and those coalesce to their publish, so a
-- channel-scoped lookup could match one and, on update, convert it.
--
-- Declared out here rather than inline because 20260915195006 added it
-- `not valid` and 20260916050127 validated it, and a CREATE TABLE constraint
-- has no way to express that history.
--
-- It is **validated** now, which matters: `not valid` postpones the scan, not
-- the rule, so a legacy dual-scope row could not be updated at all — the sync
-- failed it with 23514 and logged the error at warn, and that
-- publish/date/category silently stopped being recorded. 20260916050127
-- normalises those rows to their publish (where every reader already counted
-- them, so no total moves) and validates.
alter table public.revenue_records
  add constraint revenue_records_single_scope_check
  check (num_nonnulls(publish_id, account_id) = 1);

comment on table public.revenue_records is 'Daily revenue records per publish (or per account for channel-level revenue), split by category';
comment on column public.revenue_records.source is 'Source of revenue data: api (fetched from platform) or manual (user entered)';
comment on column public.revenue_records.category is 'Revenue category: ads, premium, sponsorship, product, affiliate, licensing, other';
comment on column public.revenue_records.account_id is 'Set instead of publish_id for channel-level revenue (sponsorships, product sales)';
comment on column public.revenue_records.breakdown is 'JSONB with detailed revenue breakdown (adRevenueCents, membershipRevenueCents, etc.)';

-- Uniqueness includes category: YouTube writes separate ads and premium
-- rows for the same publish and day
-- One row per scope, date, category, source and currency. A synced figure and a
-- hand-entered one are different money: they coexist and sum, and neither
-- can overwrite the other. Adding `source` is what removed the sync's
-- skip-guard, the action's synced-refusal, and a manual `other` entry
-- blocking a publish's platform revenue for good.
--
-- Currency joined the key in KB-23 (20260924222142): two currencies are
-- separate money (KB-12), so a €50 and a $100 sponsorship on one day both
-- stand. `nulls not distinct` keeps two currency-less rows a duplicate.
create unique index if not exists idx_revenue_records_unique_scope
  on public.revenue_records (
    coalesce(publish_id, account_id),
    record_date,
    category,
    source,
    currency
  ) nulls not distinct;

-- Indexes for revenue queries
create index if not exists idx_revenue_records_publish_date on public.revenue_records(publish_id, record_date desc);
create index if not exists idx_revenue_records_account_date on public.revenue_records(account_id, record_date desc)
  where account_id is not null;
create index if not exists idx_revenue_records_platform_date on public.revenue_records(platform, record_date desc);
create index if not exists idx_revenue_records_source on public.revenue_records(source);
create index if not exists idx_revenue_records_category on public.revenue_records(category);
create index if not exists idx_revenue_records_date_range on public.revenue_records(record_date desc) where revenue_cents > 0;

-- Updated timestamp trigger
create trigger set_revenue_records_timestamp
  before update on public.revenue_records
  for each row
  execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Revenue Reports Table
-- ==================================
-- Generated summary reports for periods

create table if not exists public.revenue_reports (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  period_type varchar(20) not null, -- 'monthly', 'quarterly', 'yearly', 'custom'
  start_date date not null,
  end_date date not null,
  summary_data jsonb not null,
  top_performers jsonb default '[]',
  platform_breakdown jsonb default '[]',
  file_url text,
  file_format varchar(10),
  created_at timestamp with time zone default now() not null,
  check (period_type in ('monthly', 'quarterly', 'yearly', 'custom'))
);

comment on table public.revenue_reports is 'Generated revenue reports with summaries and breakdowns';
comment on column public.revenue_reports.summary_data is 'JSONB with RevenueSummary data';
comment on column public.revenue_reports.top_performers is 'JSONB array of top performing content';

create index if not exists idx_revenue_reports_account_period on public.revenue_reports(account_id, period_type, start_date desc);
create index if not exists idx_revenue_reports_account_date on public.revenue_reports(account_id, start_date desc, end_date desc);

-- ==================================
-- Section: Revenue Alerts Table
-- ==================================
-- Notifications for significant revenue changes

create table if not exists public.revenue_alerts (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  alert_type varchar(50) not null, -- 'threshold_reached', 'significant_change', 'policy_change'
  title varchar(255) not null,
  message text,
  severity varchar(20) default 'info', -- 'info', 'warning', 'critical'
  related_data jsonb,
  is_read boolean default false,
  created_at timestamp with time zone default now() not null,
  check (alert_type in ('threshold_reached', 'significant_change', 'policy_change')),
  check (severity in ('info', 'warning', 'critical'))
);

comment on table public.revenue_alerts is 'Alerts for significant revenue changes and monetization events';

create index if not exists idx_revenue_alerts_account_unread on public.revenue_alerts(account_id, is_read, created_at desc) where is_read = false;
create index if not exists idx_revenue_alerts_account_created on public.revenue_alerts(account_id, created_at desc);

-- ==================================
-- Section: Enable RLS
-- ==================================

alter table public.revenue_records enable row level security;
alter table public.revenue_reports enable row level security;
alter table public.revenue_alerts enable row level security;

-- ==================================
-- Section: Revoke Default Permissions
-- ==================================

revoke all on public.revenue_records from authenticated, service_role;
revoke all on public.revenue_reports from authenticated, service_role;
revoke all on public.revenue_alerts from authenticated, service_role;

-- ==================================
-- Section: Grant Specific Permissions
-- ==================================

grant select, insert, update, delete on table public.revenue_records to authenticated;
grant select, insert, update, delete on table public.revenue_reports to authenticated;
grant select, insert, update, delete on table public.revenue_alerts to authenticated;

-- ==================================
-- Section: Revenue Records RLS Policies
-- ==================================
-- Access control through publish -> episode -> project -> account chain

create policy "revenue_records_read" on public.revenue_records for select
  to authenticated using (
    (
      account_id is not null
      and public.has_account_access(account_id)
    )
    -- An uncorrelated set, built once per query rather than walked per row
    -- (KB-13: 20260925132423_kb13-revenue-read-policy-once.sql)
    or publish_id in (
      select pub.id from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.projects p on p.id = e.project_id
      where
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
    )
  );

-- Who may write a revenue row, stated once.
--
-- Channel-level revenue may be changed by an account owner or by the person
-- who recorded it; per-video revenue by any member of the publish's project.
-- The rule lived in three places — update USING, update WITH CHECK, delete
-- USING — and two of them diverging is how `created_by` briefly became
-- writable by anyone who could already edit the row.
--
-- Security invoker, unlike `has_account_access`: the expression this replaces
-- was inline in the policy, so it read `project_members` under the caller's
-- own RLS. A definer function would quietly widen that.
create or replace function public.can_write_revenue_record(
  target_publish_id uuid,
  target_account_id uuid,
  record_author uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (
      target_account_id is not null
      and (
        public.is_account_owner(target_account_id)
        or public.has_role_on_account(target_account_id, 'owner')
        or record_author = (select auth.uid())
      )
    )
    or exists (
      select 1
      from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = target_publish_id
        and pm.user_id = (select auth.uid())
        and pm.role in ('owner', 'admin', 'member')
    );
$$;

comment on function public.can_write_revenue_record(uuid, uuid, uuid) is
  'Channel-level revenue may be changed by an account owner or by the person who recorded it; per-video revenue by any member of the publish''s project. The single definition behind revenue_records update and delete.';

grant execute on function public.can_write_revenue_record(uuid, uuid, uuid) to authenticated;

-- `source = 'manual'` is enforced here, not only in the action: `source`
-- decides whether a row can ever be removed through the app, and a rule the
-- app keeps to itself is not a rule. The sync writes 'api' through the
-- service-role client, which bypasses RLS.
--
-- `created_by` is constrained for the same reason one level down: it is what
-- the update and delete policies authorize on, so a caller able to name
-- somebody else can rewrite who those policies answer to. Null stays
-- permitted, matching `verified_facts` — a row with no author is owner-only
-- for good, which is the safe way to be wrong about authorship.
create policy "revenue_records_create" on public.revenue_records for insert
  to authenticated with check (
    source = 'manual'
    and (created_by is null or created_by = (select auth.uid()))
    and (
      (
        account_id is not null
        and public.has_account_access(account_id)
      )
      or exists (
        select 1
        from public.publishes pub
        join public.episodes e on e.id = pub.episode_id
        join public.project_members pm on pm.project_id = e.project_id
        where pub.id = revenue_records.publish_id
          and pm.user_id = (select auth.uid())
          and pm.role in ('owner', 'admin', 'member')
      )
    )
  );

-- Postgres uses USING as the check expression for UPDATE only when WITH CHECK
-- is absent, so naming one silently drops the other. Both are named.
--
-- `source = 'manual'` is in USING as well as WITH CHECK, and that asymmetry
-- was a hole: with it only in WITH CHECK, a project member could PATCH the
-- platform's `api` row to an arbitrary figure, because USING passed on the old
-- row and WITH CHECK passed on the new one that now said 'manual'. A synced
-- row is the platform's record of what it paid and is not this app's to select
-- for update at all. The sync writes through the service-role client, which
-- bypasses RLS.
create policy "revenue_records_update" on public.revenue_records for update
  to authenticated
  using (
    source = 'manual'
    and public.can_write_revenue_record(publish_id, account_id, created_by)
  )
  with check (
    source = 'manual'
    and public.can_write_revenue_record(publish_id, account_id, created_by)
  );

-- The account branch is the same rule. The publish branch is deliberately
-- stricter than update — project owner or admin, or the author — so it keeps
-- its own expression rather than calling the shared function.
create policy "revenue_records_delete" on public.revenue_records for delete
  to authenticated using (
    -- `deleteManualRevenueAction` filters to source = 'manual'; PostgREST does
    -- not have to, so a project owner or admin could remove synced rows.
    source = 'manual'
    and (
    (
      account_id is not null
      and (
        public.is_account_owner(account_id)
        or public.has_role_on_account(account_id, 'owner')
        or created_by = (select auth.uid())
      )
    )
    or exists (
      select 1
      from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = revenue_records.publish_id
        and pm.user_id = (select auth.uid())
        and (
          pm.role in ('owner', 'admin')
          or revenue_records.created_by = (select auth.uid())
        )
    )
    )
  );

-- ==================================
-- Section: Authorship is written once
-- ==================================
-- The update and delete policies authorize on `created_by`, so a writer who
-- can change it can change who those policies answer to. A member who pins a
-- colleague's per-video row on themselves gains a delete right that otherwise
-- needs project owner or admin.
--
-- A trigger rather than a policy clause, because a policy cannot see OLD — and
-- because one total statement beats restating the rule on each branch. No code
-- path sets `created_by` on update: the action excludes it deliberately, and
-- the sync never names it.
--
-- **Erasing is allowed; naming is not.** `on delete set null` is implemented as
-- an internal UPDATE, and a BEFORE UPDATE row trigger fires on it — so a freeze
-- against *any* change also rejected the foreign key's own set-null, and every
-- user who had saved one entry became undeletable. The condition is therefore
-- on the new value, not on the change.

create or replace function public.revenue_records_freeze_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is not null
     and new.created_by is distinct from old.created_by then
    raise exception 'revenue_records.created_by is immutable'
      using hint = 'Authorship is recorded on insert. A correction does not transfer it, and a deleted user''s entries keep their figures without an author.';
  end if;

  return new;
end;
$$;

comment on function public.revenue_records_freeze_created_by() is
  'Rejects any UPDATE that points revenue_records.created_by at a user. The update and delete policies authorize on that column, so letting a writer set it lets them choose who those policies answer to. Clearing it is allowed: the auth.users foreign key does exactly that, as an UPDATE, when an author is deleted.';

drop trigger if exists revenue_records_freeze_created_by on public.revenue_records;

create trigger revenue_records_freeze_created_by
  before update on public.revenue_records
  for each row
  execute function public.revenue_records_freeze_created_by();

-- ==================================
-- Section: Revenue Reports RLS Policies
-- ==================================
-- Account-scoped access using has_account_access helper

create policy "revenue_reports_read" on public.revenue_reports for select
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "revenue_reports_create" on public.revenue_reports for insert
  to authenticated with check (
    public.has_account_access(account_id)
  );

create policy "revenue_reports_update" on public.revenue_reports for update
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "revenue_reports_delete" on public.revenue_reports for delete
  to authenticated using (
    public.has_account_access(account_id)
  );

-- ==================================
-- Section: Revenue Alerts RLS Policies
-- ==================================
-- Account-scoped access using has_account_access helper

create policy "revenue_alerts_read" on public.revenue_alerts for select
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "revenue_alerts_create" on public.revenue_alerts for insert
  to authenticated with check (
    public.has_account_access(account_id)
  );

create policy "revenue_alerts_update" on public.revenue_alerts for update
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "revenue_alerts_delete" on public.revenue_alerts for delete
  to authenticated using (
    public.has_account_access(account_id)
  );

-- Lifetime revenue per publish per currency, summed in the database
-- (FILM-1615). Reading the rows instead made one page of the Video Log take
-- 98 seconds: revenue is a row per publish per day per category, so 100
-- videos with a year of it is 36,500 rows for 200 sums.
--
-- `security invoker`, so `revenue_records_read` decides what is in each sum
-- rather than the function re-deriving that policy by hand.
create or replace function public.revenue_cents_by_publish(
  p_publish_ids uuid[]
)
returns table (
  publish_id uuid,
  currency text,
  cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.publish_id,
    r.currency::text,
    sum(r.revenue_cents)::bigint
  from public.revenue_records r
  where r.publish_id = any(p_publish_ids)
  group by r.publish_id, r.currency::text
$$;

grant execute on function public.revenue_cents_by_publish(uuid[])
  to authenticated, service_role;
