begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- FILM-1726. A synced (`api`) row whose earnings were never measured holds
-- NULL, not 0. Before FILM-1711 the sync wrote zero-valued `api` rows for
-- every YouTube day without the monetary scope, and `effectiveRevenueCategory`
-- reads `source = 'api'` as proof of what the platform paid. Those rows are
-- kept and marked NULL instead of deleted, so nothing is lost. A person's
-- entry still always has a figure.
select plan(7);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

-- The project trigger adds its creator as a member, so someone is signed in.
select makerkit.authenticate_as('primary_owner');
set local role postgres;
select set_config('rev.story', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, slug)
values (
  'dddddddd-0000-4000-8000-000000000001',
  current_setting('rev.story')::uuid,
  'Unmeasured probe',
  'unmeasured-probe'
);

insert into public.episodes (id, project_id, number, title)
values (
  'dddddddd-0000-4000-8000-000000000002',
  'dddddddd-0000-4000-8000-000000000001',
  1,
  'Episode'
);

insert into public.publishes (id, episode_id, platform, status, published_at)
values (
  'dddddddd-0000-4000-8000-000000000003',
  'dddddddd-0000-4000-8000-000000000002',
  'youtube',
  'published',
  now()
);

-- ==================================
-- The column
-- ==================================

select col_is_null(
  'public', 'revenue_records', 'revenue_cents',
  'revenue_cents may be NULL: not measured'
);

select col_hasnt_default(
  'public', 'revenue_records', 'revenue_cents',
  'No default: a row that does not say what it measured is not measured'
);

select lives_ok(
  $$ insert into public.revenue_records
       (publish_id, platform, record_date, revenue_cents, currency, source, category)
     values ('dddddddd-0000-4000-8000-000000000003', 'youtube', '2026-02-01',
             null, 'USD', 'api', 'ads') $$,
  'A synced row may say it measured nothing'
);

select throws_ok(
  $$ insert into public.revenue_records
       (publish_id, platform, record_date, revenue_cents, currency, source, category)
     values ('dddddddd-0000-4000-8000-000000000003', 'youtube', '2026-02-01',
             null, 'USD', 'manual', 'other') $$,
  '23514',
  null,
  'A person''s entry always carries a figure'
);

-- ==================================
-- The sum per publish skips what was not measured
-- ==================================

insert into public.revenue_records
  (publish_id, platform, record_date, revenue_cents, currency, source, category)
values
  ('dddddddd-0000-4000-8000-000000000003', 'youtube', '2026-02-02', 700, 'USD', 'api', 'ads'),
  ('dddddddd-0000-4000-8000-000000000003', 'youtube', '2026-02-03', null, 'EUR', 'api', 'ads');

select makerkit.authenticate_as('primary_owner');

select results_eq(
  $$ select currency, cents from public.revenue_cents_by_publish(
       array['dddddddd-0000-4000-8000-000000000003'::uuid])
     order by currency $$,
  $$ values ('USD', 700::bigint) $$,
  'USD 700 from the measured day; no EUR row, because no EUR day was measured'
);

-- ==================================
-- Nothing reached through an end-user JWT can write a NULL
-- ==================================

select throws_ok(
  $$ insert into public.revenue_records
       (publish_id, platform, record_date, revenue_cents, currency, source,
        category, created_by)
     values ('dddddddd-0000-4000-8000-000000000003', 'youtube', '2026-02-04',
             null, 'USD', 'manual', 'other', (select auth.uid())) $$,
  '23514',
  null,
  'The owner cannot enter an empty amount either'
);

set local role postgres;

select is(
  (select pg_catalog.col_description(
     'public.revenue_records'::regclass,
     (select attnum from pg_catalog.pg_attribute
       where attrelid = 'public.revenue_records'::regclass
         and attname = 'revenue_cents')) like '%not measured%'),
  true,
  'The column says what NULL means, where the next reader will look'
);

select * from finish();
rollback;
