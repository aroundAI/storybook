-- FILM-1726. A synced revenue row that measured nothing holds NULL, not 0.
--
-- Until FILM-1711 (#289), the YouTube sync asked for revenue without the
-- monetary scope, got nothing back, and wrote a zero-valued `api` row for
-- every category of every publish-day. `effectiveRevenueCategory` reads
-- `source = 'api'` as proof of what the platform paid, so those rows say
-- "YouTube paid $0" when YouTube was never asked. FILM-1711 stopped new ones:
-- the sync writes revenue only when it was measured, and
-- `planRevenueRowWrites` never inserts a zero. The ones already written are
-- marked here.
--
-- They are not deleted. Deletion is irreversible, and this runs against
-- production. NULL keeps the row and drops the false claim: every sum skips
-- it, and the row stays available to anyone auditing what the sync did.
--
-- Which rows: `source = 'api'` and `revenue_cents = 0`. In production no
-- connection has held the monetary scope (ANALYTICS_SCOPES_ENABLED is unset
-- there, FILM-1711 Deployment), so every such row predates any measurement.
-- Elsewhere, a zero can be a measured one, but only as a correction of an
-- earlier figure (`planRevenueRowWrites`). Marking it NULL changes no sum,
-- and the next authorised sync writes the measured value back.
--
-- A person's entry always carries a figure: the check below holds `manual`
-- rows to NOT NULL, as the column did.
--
-- ROLLBACK: `update public.revenue_records set revenue_cents = 0
--   where revenue_cents is null;` then restore `not null default 0`, drop
--   the check, and re-create `revenue_cents_by_publish` from 20260920050750.

alter table public.revenue_records
  alter column revenue_cents drop not null,
  alter column revenue_cents drop default;

alter table public.revenue_records
  add constraint revenue_records_manual_has_amount
  check (revenue_cents is not null or source = 'api');

comment on column public.revenue_records.revenue_cents is
  'Amount in the row''s currency, in cents. NULL on a synced (api) row means not measured: the platform was not asked, or would not answer. It is never a payout of 0 (FILM-1726).';

update public.revenue_records
set revenue_cents = null
where source = 'api'
  and revenue_cents = 0;

-- Only what was measured is summed: a publish whose every row in a currency
-- is NULL gets no row for that currency, never a 0.
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
    and r.revenue_cents is not null
  group by r.publish_id, r.currency::text
$$;
