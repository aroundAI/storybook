-- ==================================
-- FILM-1508: Revenue mix categories
-- ==================================
-- Splits revenue by category (ads | premium | sponsorship | product |
-- affiliate | other) so the revenue-mix health signal — ads falling as a
-- share of total — becomes measurable. Sponsorship and product revenue is
-- often channel-level rather than attributable to one video, so
-- publish_id becomes nullable with an account_id alternative.

alter table public.revenue_records
  add column if not exists category varchar(30) not null default 'ads';

alter table public.revenue_records
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

alter table public.revenue_records
  alter column publish_id drop not null;

comment on column public.revenue_records.category is 'Revenue category: ads, premium, sponsorship, product, affiliate, other';
comment on column public.revenue_records.account_id is 'Set instead of publish_id for channel-level revenue (sponsorships, product sales)';

-- Category vocabulary
alter table public.revenue_records
  drop constraint if exists revenue_records_category_check;

alter table public.revenue_records
  add constraint revenue_records_category_check
  check (category in ('ads', 'premium', 'sponsorship', 'product', 'affiliate', 'other'));

-- A record attaches to either a publish or an account, never neither
alter table public.revenue_records
  drop constraint if exists revenue_records_scope_check;

alter table public.revenue_records
  add constraint revenue_records_scope_check
  check (publish_id is not null or account_id is not null);

-- ==================================
-- Uniqueness now includes the category
-- ==================================
-- YouTube writes an 'ads' and a 'premium' row for the same publish/day, so
-- the old (publish_id, record_date) key would make them clobber each other.

alter table public.revenue_records
  drop constraint if exists revenue_records_publish_id_record_date_key;

create unique index if not exists idx_revenue_records_unique_scope
  on public.revenue_records (
    coalesce(publish_id, account_id), record_date, category
  );

create index if not exists idx_revenue_records_account_date
  on public.revenue_records(account_id, record_date desc)
  where account_id is not null;

create index if not exists idx_revenue_records_category
  on public.revenue_records(category);

-- ==================================
-- Backfill historical rows into categories
-- ==================================
-- Existing api rows stored the YouTube ad/premium split in breakdown jsonb
-- but recorded a single combined revenue_cents row. Split them so history
-- lines up with what the sync now writes.

insert into public.revenue_records (
  publish_id, platform, record_date, revenue_cents, currency,
  source, category, breakdown, metadata
)
select
  r.publish_id,
  r.platform,
  r.record_date,
  (r.breakdown ->> 'redRevenueCents')::integer,
  r.currency,
  r.source,
  'premium',
  '{}'::jsonb,
  jsonb_build_object('backfilled_from', r.id)
from public.revenue_records r
where r.source = 'api'
  and r.category = 'ads'
  and r.breakdown ? 'redRevenueCents'
  and (r.breakdown ->> 'redRevenueCents')::integer > 0
on conflict do nothing;

-- The originating rows keep only their ad revenue
update public.revenue_records r
set revenue_cents = (r.breakdown ->> 'adRevenueCents')::integer
where r.source = 'api'
  and r.category = 'ads'
  and r.breakdown ? 'adRevenueCents'
  and (r.breakdown ->> 'adRevenueCents')::integer > 0;

-- ==================================
-- RLS: add the account-level branch
-- ==================================

drop policy if exists "revenue_records_read" on public.revenue_records;

create policy "revenue_records_read" on public.revenue_records for select
  to authenticated using (
    (
      account_id is not null
      and public.has_account_access(account_id)
    )
    or exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.projects p on p.id = e.project_id
      where pub.id = revenue_records.publish_id
      and (
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );

drop policy if exists "revenue_records_create" on public.revenue_records;

create policy "revenue_records_create" on public.revenue_records for insert
  to authenticated with check (
    (
      account_id is not null
      and public.has_account_access(account_id)
    )
    or exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = revenue_records.publish_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

drop policy if exists "revenue_records_update" on public.revenue_records;

create policy "revenue_records_update" on public.revenue_records for update
  to authenticated using (
    (
      account_id is not null
      and public.has_account_access(account_id)
    )
    or exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = revenue_records.publish_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );
