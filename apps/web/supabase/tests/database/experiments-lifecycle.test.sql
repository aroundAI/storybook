begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(19);

-- FILM-1610 review, round 4 (G2). The lifecycle the actions follow, held by
-- the table: a member going straight to PostgREST could move a running
-- experiment back to planned, change its frozen metric, conclude it with an
-- end before its start and replace its baseline. Each of those is refused
-- here, and each legal step is shown to still work.

select makerkit.set_identifier('member', 'member@storybook.dev');

set local role postgres;

select set_config('lc.story', makerkit.get_account_id_by_slug('storybook')::text, true);

select makerkit.authenticate_as('member');

-- ==================================
-- A new experiment is planned, with nothing measured
-- ==================================

select throws_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, status)
     values (current_setting('lc.story')::uuid, 'Born running', 'x', 'running') $$,
  'P0001',
  null,
  'An experiment cannot be created running'
);

select throws_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, baseline_metrics)
     values (current_setting('lc.story')::uuid, 'Pre-measured', 'x', '{"forged": true}') $$,
  'P0001',
  null,
  'nor with a baseline already in it'
);

select lives_ok(
  $$ insert into public.analytics_experiments (id, account_id, title, change_description)
     values ('c4c4c4c4-0000-4000-8000-000000000001', current_setting('lc.story')::uuid, 'Lifecycle', 'x'),
            ('c4c4c4c4-0000-4000-8000-000000000002', current_setting('lc.story')::uuid, 'Abandoned early', 'x') $$,
  'A planned experiment is created'
);

-- ==================================
-- Start
-- ==================================

select throws_ok(
  $$ update public.analytics_experiments set status = 'concluded'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'A planned experiment cannot skip straight to concluded'
);

select lives_ok(
  $$ update public.analytics_experiments
        set status = 'running', started_at = '2026-07-10', baseline_metrics = '{"real": 1}'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'Starting records the start date and the baseline'
);

select throws_ok(
  $$ update public.analytics_experiments set status = 'planned'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'A running experiment cannot go back to planned'
);

select throws_ok(
  $$ update public.analytics_experiments set baseline_metrics = '{"forged": true}'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'Its baseline cannot be replaced'
);

select throws_ok(
  $$ update public.analytics_experiments set started_at = '2026-01-01'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'Its start date cannot be moved'
);

select throws_ok(
  $$ update public.analytics_experiments set result_metrics = '{"early": true}'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'It cannot be given a result without concluding'
);

-- ==================================
-- Conclude
-- ==================================

select throws_ok(
  $$ update public.analytics_experiments
        set status = 'concluded', ended_at = '2026-07-09', result_metrics = '{"real": 2}'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'It cannot end before it started'
);

select lives_ok(
  $$ update public.analytics_experiments
        set status = 'concluded', ended_at = '2026-08-10', result_metrics = '{"real": 2}',
            actual_outcome = 'CTR rose', outcome_status = 'confirmed'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'Concluding records the end date and the result'
);

select throws_ok(
  $$ update public.analytics_experiments set result_metrics = '{"forged": true}'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'The result cannot be replaced afterwards'
);

select throws_ok(
  $$ update public.analytics_experiments set ended_at = '2026-09-01'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'nor the end date'
);

select throws_ok(
  $$ update public.analytics_experiments set status = 'abandoned'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'P0001',
  null,
  'A concluded experiment cannot be abandoned'
);

select lives_ok(
  $$ update public.analytics_experiments
        set title = 'Lifecycle, renamed', actual_outcome = 'CTR rose 0.4 points'
      where id = 'c4c4c4c4-0000-4000-8000-000000000001' $$,
  'Its wording and outcome text are still editable'
);

-- ==================================
-- Abandon
-- ==================================

select lives_ok(
  $$ update public.analytics_experiments
        set status = 'abandoned', ended_at = '2026-07-11', outcome_status = 'inconclusive'
      where id = 'c4c4c4c4-0000-4000-8000-000000000002' $$,
  'A planned experiment can be abandoned'
);

select throws_ok(
  $$ update public.analytics_experiments set status = 'running', started_at = '2026-07-12'
      where id = 'c4c4c4c4-0000-4000-8000-000000000002' $$,
  'P0001',
  null,
  'and an abandoned one cannot be revived'
);

-- ==================================
-- The service role is not held to it
-- ==================================
-- Seeds and repairs write any state directly: a service-role request
-- carries no user, so auth.uid() is null.

select tests.clear_authentication();
set local role service_role;

select lives_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, status, started_at)
     values (current_setting('lc.story')::uuid, 'Seeded running', 'x', 'running', '2026-07-01') $$,
  'A seed can create a running experiment'
);

select is(
  (select status || ' ' || ended_at::text from public.analytics_experiments
    where id = 'c4c4c4c4-0000-4000-8000-000000000001'),
  'concluded 2026-08-10',
  'and every refused write above left the concluded experiment as it was'
);

select * from finish();

rollback;
