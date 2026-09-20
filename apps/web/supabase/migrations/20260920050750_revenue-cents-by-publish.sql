-- Lifetime revenue per publish per currency, summed in the database.
--
-- The Video Log (FILM-1615) shows one revenue figure per video per
-- currency. It got there by reading every revenue row for the page's 100
-- videos and folding them in TypeScript — and revenue is a row per publish
-- per day per category, so a page of videos with a year of daily revenue
-- is 36,500 rows, read 1,000 at a time through PostgREST.
--
-- Measured on that shape: **98.5 seconds** for one page. Almost none of it
-- is query time. The same rows aggregate in the database in ~1.1s under
-- RLS (11ms without it); the rest was 37 sequential round trips and the
-- serialization of 36,500 JSON rows to produce 200 sums.
--
-- So: group here, and return the 200 rows the caller actually wants.
--
-- `security invoker` on purpose. The sum must contain exactly the rows the
-- caller may read, and `revenue_records_read` is what decides that — a
-- definer function would have to re-derive that policy by hand, which is
-- how a tenant leak gets written. The cost is that RLS is evaluated per
-- row before aggregation; that is the ~1.1s, and it is the price of the
-- policy being the one thing that decides.
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

comment on function public.revenue_cents_by_publish(uuid[]) is
  'Lifetime revenue per publish per currency, in cents. Grouped rather than summed across currencies: adding dollars to euros produces a number that is neither. Runs as the caller, so revenue_records RLS decides which rows are in the sum.';

grant execute on function public.revenue_cents_by_publish(uuid[])
  to authenticated, service_role;
