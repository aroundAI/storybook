-- KB-23: a second currency for the same day overwrote the first.
--
-- idx_revenue_records_unique_scope keyed on
-- (coalesce(publish_id, account_id), record_date, category, source), so a
-- €50 and a $100 sponsorship on one day, scope and category could not both
-- exist. addManualRevenueAction looked the existing row up by that key,
-- found the euro row, and replaced it with the dollars — no error, and a
-- success toast. Currency is separate money (KB-12, decided by the product
-- owner: no exchange rates), so it joins the key.
--
-- Normalised first, to the key every reader folds by (`currencyKey` in
-- money.ts: trimmed, upper-case), so the index and the dashboard agree on
-- what "one currency" is. This cannot collide: the old key has no currency
-- in it, so no two rows share a scope, date, category and source today.
--
-- Adding a column to a unique key is a relaxation, so no existing row can
-- violate the new index either.
--
-- `nulls not distinct`: a row without a currency is its own bucket, never
-- assumed to be dollars (money.ts). Two of them on one key stay a
-- duplicate, as they were before currency joined the key.

update public.revenue_records
   set currency = upper(btrim(currency))
 where currency is distinct from upper(btrim(currency));

drop index if exists public.idx_revenue_records_unique_scope;

create unique index idx_revenue_records_unique_scope
  on public.revenue_records (
    coalesce(publish_id, account_id),
    record_date,
    category,
    source,
    currency
  ) nulls not distinct;

comment on index public.idx_revenue_records_unique_scope is
  'One row per scope, date, category, source and currency. Synced and hand-entered figures coexist and sum; two currencies coexist and are never summed; neither can overwrite the other.';
