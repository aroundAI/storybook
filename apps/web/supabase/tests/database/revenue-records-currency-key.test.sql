begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-23: a second currency for the same day must not overwrite the first.
--
-- `idx_revenue_records_unique_scope` keyed on scope, date, category and
-- source, so a €50 and a $100 sponsorship on one day could not both exist —
-- and `addManualRevenueAction`, finding the € row by that key, replaced it
-- with the $ one. Currency is separate money (KB-12), so it is part of the
-- key. The same currency on the same key is still one row: saving again is
-- a correction.
select plan(6);

set local role postgres;
select set_config('rev.story', makerkit.get_account_id_by_slug('storybook')::text, true);

select lives_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, currency, source, category)
     values (current_setting('rev.story')::uuid, 'manual', '2026-09-24', 5000, 'EUR', 'manual', 'sponsorship') $$,
  'A euro sponsorship is recorded'
);

select lives_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, currency, source, category)
     values (current_setting('rev.story')::uuid, 'manual', '2026-09-24', 10000, 'USD', 'manual', 'sponsorship') $$,
  'A dollar sponsorship on the same day, scope and category sits beside it'
);

select throws_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, currency, source, category)
     values (current_setting('rev.story')::uuid, 'manual', '2026-09-24', 6000, 'EUR', 'manual', 'sponsorship') $$,
  '23505',
  null,
  'A second euro figure for the same key is refused: one row per currency'
);

-- Null is "currency not recorded", its own bucket (money.ts). Two of them
-- on one key would be a duplicate, as they always were.
select lives_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, currency, source, category)
     values (current_setting('rev.story')::uuid, 'manual', '2026-09-24', 700, null, 'manual', 'product') $$,
  'A row without a currency is recorded'
);

select throws_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, currency, source, category)
     values (current_setting('rev.story')::uuid, 'manual', '2026-09-24', 800, null, 'manual', 'product') $$,
  '23505',
  null,
  'Two rows without a currency on one key are still a duplicate'
);

select is(
  (select array_agg(a.attname order by a.attname)::text[]
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where c.relname = 'idx_revenue_records_unique_scope'),
  array['category', 'currency', 'record_date', 'source']::text[],
  'The unique key names currency (the scope is an expression, so not listed)'
);

select * from finish();
rollback;
