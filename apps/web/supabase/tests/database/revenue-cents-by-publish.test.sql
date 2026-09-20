begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- `revenue_cents_by_publish` exists because reading revenue row by row made
-- one page of the Video Log take 98 seconds. Moving a read into a function
-- is where a tenant boundary gets lost by accident, so this exercises the
-- function with real roles rather than trusting that `security invoker`
-- was typed correctly: the sums a caller gets back must contain exactly the
-- rows `revenue_records_read` would have let them select.
select plan(6);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

-- An outsider with an account of their own, and no access to `storybook`.
select tests.create_supabase_user('outsider', 'outsider@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('Other Co');

set local role postgres;
select set_config('rev.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- A project, an episode and a publish on the storybook account, then two
-- currencies of revenue against that publish across two days.
insert into public.projects (id, account_id, name, slug)
values (
  'cccccccc-0000-4000-8000-000000000001',
  current_setting('rev.story')::uuid,
  'Revenue probe',
  'revenue-probe'
);

insert into public.episodes (id, project_id, number, title)
values (
  'cccccccc-0000-4000-8000-000000000002',
  'cccccccc-0000-4000-8000-000000000001',
  1,
  'Episode'
);

insert into public.publishes (id, episode_id, platform, status, published_at)
values (
  'cccccccc-0000-4000-8000-000000000003',
  'cccccccc-0000-4000-8000-000000000002',
  'youtube',
  'published',
  now()
);

insert into public.revenue_records
  (publish_id, platform, record_date, revenue_cents, currency, source)
values
  ('cccccccc-0000-4000-8000-000000000003', 'youtube', '2026-01-01', 1000, 'USD', 'api'),
  ('cccccccc-0000-4000-8000-000000000003', 'youtube', '2026-01-02', 200, 'USD', 'api'),
  ('cccccccc-0000-4000-8000-000000000003', 'youtube', '2026-01-03', 500, 'EUR', 'api');

-- ==================================
-- The owner: one row per currency, summed
-- ==================================

select makerkit.authenticate_as('primary_owner');

select results_eq(
  $$ select currency, cents from public.revenue_cents_by_publish(
       array['cccccccc-0000-4000-8000-000000000003'::uuid])
     order by currency $$,
  $$ values ('EUR', 500::bigint), ('USD', 1200::bigint) $$,
  'Sums per currency — and EUR 500 is not added to USD 1200'
);

-- The value that would appear if the currencies were pooled. Named here so
-- a regression to one figure fails on the number a reader would see.
select is(
  (select count(*)::int from public.revenue_cents_by_publish(
     array['cccccccc-0000-4000-8000-000000000003'::uuid])),
  2,
  'Two rows, not one: currencies are grouped, never summed together'
);

select is(
  (select cents from public.revenue_cents_by_publish(
     array['cccccccc-0000-4000-8000-000000000003'::uuid]) where currency = 'USD'),
  1200::bigint,
  'Same-currency days are added'
);

-- ==================================
-- Another account: nothing, not a total
-- ==================================

select makerkit.authenticate_as('outsider');

select is_empty(
  $$ select * from public.revenue_cents_by_publish(
       array['cccccccc-0000-4000-8000-000000000003'::uuid]) $$,
  'A caller with no role on the account sums none of its revenue'
);

-- The publish id is guessable, and the function takes it directly, so the
-- refusal has to come from the policy rather than from the caller passing
-- only ids it already knows.
select is(
  (select coalesce(sum(cents), 0) from public.revenue_cents_by_publish(
     array['cccccccc-0000-4000-8000-000000000003'::uuid])),
  0::numeric,
  'No partial total leaks either'
);

-- ==================================
-- Anonymous
-- ==================================

set local role anon;

select throws_ok(
  $$ select * from public.revenue_cents_by_publish(
       array['cccccccc-0000-4000-8000-000000000003'::uuid]) $$,
  '42501',
  null,
  'Anonymous callers may not execute it at all'
);

select * from finish();
rollback;
