-- A synced figure and a hand-entered one are different money.
--
-- idx_revenue_records_unique_scope keyed on
-- (coalesce(publish_id, account_id), record_date, category) — one row per
-- scope, date and category regardless of who wrote it. Everything awkward
-- in this area followed from that: the platform's figure and a person's
-- competed for one slot, so one had to lose; guarding that made `source` an
-- authorization input; and a manual `other` entry could hold a publish's
-- slot forever, so the platform's uncategorized revenue for that day was
-- never recorded at all.
--
-- `source` joins the key. A day and category may now hold at most one
-- synced figure and at most one hand-entered figure, and the total is their
-- sum — which is what every consumer already does: each caller of
-- forEachAccountRevenueRow folds with `+=`, and nothing reads a single row
-- per key.
--
-- This is a relaxation, so no existing row can violate it.

drop index if exists idx_revenue_records_unique_scope;

create unique index idx_revenue_records_unique_scope
  on public.revenue_records (
    coalesce(publish_id, account_id),
    record_date,
    category,
    source
  );

comment on index public.idx_revenue_records_unique_scope is
  'One row per scope, date, category and source. Synced and hand-entered figures coexist and sum; neither can overwrite the other.';

-- A row belongs to a video or to a channel, never both.
--
-- revenue_records_scope_check requires *at least* one id, which allowed
-- rows carrying both — and those coalesce to their publish, so a
-- channel-scoped lookup could match one and, on update, null its publish_id
-- and convert it. `not valid` binds new and updated rows without scanning
-- history, so legacy rows are left alone rather than blocking the
-- migration.
alter table public.revenue_records
  add constraint revenue_records_single_scope_check
  check (num_nonnulls(publish_id, account_id) = 1) not valid;
