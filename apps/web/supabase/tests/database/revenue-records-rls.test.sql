begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count, not no_plan(): an earlier draft of this file aborted a third
-- of the way through on a permissions error and still reported one failing
-- test out of four, which reads like a nearly-passing suite. With a plan, a
-- run that stops early fails as a plan mismatch instead of looking fine.
select plan(13);

-- Revenue rows are money attributed to a tenant, and `created_by` decides who
-- may correct one later. Nine review rounds argued about these policies by
-- reading their text; this exercises them with real roles instead, because
-- reading them produced a wrong answer at least twice.
--
-- Two traps, both of which cost time here:
--
-- 1. `makerkit.get_account_id_by_slug` runs under the caller's own RLS, so
--    asking it for an account the caller cannot see returns NULL rather than
--    an id — silently turning a cross-tenant test into a null-scope test.
--    Foreign ids are stashed with `set_config` while still `postgres`.
-- 2. The update cases share one row, so each resets it first. Without that
--    they chain: the authorship case succeeds pre-fix, which strips the
--    member's own USING branch, and every later update then matches zero rows
--    and "passes" for a reason unrelated to what it claims to test.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

-- Defined while still superuser. Creating it later fails with "permission
-- denied for database postgres" and takes the rest of the file with it.
create or replace function public.revenue_rls_test_reset() returns void
  language sql security definer set search_path = '' as $fn$
  update public.revenue_records
     set revenue_cents = 1000,
         source = 'manual',
         category = 'sponsorship',
         account_id = current_setting('revtest.story')::uuid,
         publish_id = null,
         created_by = tests.get_supabase_uid('member')
   where id = 'aaaaaaaa-0000-4000-8000-000000000001';
$fn$;

-- A second team that the `storybook` member has no access to at all.
select tests.create_supabase_user('outsider', 'outsider@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('Other Co');

set local role postgres;
select set_config('revtest.other', makerkit.get_account_id_by_slug('other-co')::text, true);
select set_config('revtest.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- ==================================
-- Create
-- ==================================

select makerkit.authenticate_as('member');

select lives_ok(
  $$ insert into public.revenue_records
       (id, account_id, platform, record_date, revenue_cents, source, category, created_by)
     values
       ('aaaaaaaa-0000-4000-8000-000000000001',
        current_setting('revtest.story')::uuid,
        'manual', '2026-01-01', 1000, 'manual', 'sponsorship',
        tests.get_supabase_uid('member')) $$,
  'A member may record channel-level revenue for their own account'
);

-- `created_by` is what the update and delete policies authorize on, so a
-- caller who can name someone else can plant a row attributed to a colleague
-- and hand them edit rights over it. `verified_facts` already constrains this
-- on insert; this table did not.
select throws_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, source, category, created_by)
     values
       (current_setting('revtest.story')::uuid,
        'manual', '2026-01-02', 1000, 'manual', 'sponsorship',
        tests.get_supabase_uid('owner')) $$,
  '42501',
  'new row violates row-level security policy for table "revenue_records"',
  'A member may not attribute a new row to another user'
);

select throws_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, source, category)
     values
       (current_setting('revtest.story')::uuid,
        'manual', '2026-01-03', 1000, 'api', 'ads') $$,
  '42501',
  'new row violates row-level security policy for table "revenue_records"',
  'A member may not write a row that claims to be platform-sourced'
);

select throws_ok(
  $$ insert into public.revenue_records
       (account_id, platform, record_date, revenue_cents, source, category, created_by)
     values
       (current_setting('revtest.other')::uuid,
        'manual', '2026-01-04', 1000, 'manual', 'sponsorship',
        tests.get_supabase_uid('member')) $$,
  '42501',
  'new row violates row-level security policy for table "revenue_records"',
  'A member may not record revenue against an account they cannot access'
);

-- ==================================
-- Update
-- ==================================

select lives_ok(
  $$ update public.revenue_records set revenue_cents = 2000
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'The author may correct their own entry'
);

set local role postgres;

select is(
  (select revenue_cents from public.revenue_records
   where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  2000,
  'The correction actually landed'
);

-- Moving a row into a tenant the caller cannot reach. Worth being precise
-- about what refuses this, because a code review read this policy set and
-- concluded it was wide open.
--
-- The UPDATE policy's WITH CHECK is not what stops it. Postgres also applies
-- the SELECT policy to the row an UPDATE produces, and `revenue_records_read`
-- requires `has_account_access` on the new account_id — so this was already
-- refused. Verified on PostgreSQL 17.6, with and without RETURNING: widening
-- only the read policy lets the repoint through; widening only the update
-- policy does not.
--
-- The write policy states the rule anyway rather than leaning on that. An
-- authorization rule that holds as a side effect of a read rule is one edit
-- to the read rule away from not holding, and nothing would fail if it broke.
select public.revenue_rls_test_reset();
select makerkit.authenticate_as('member');

select throws_ok(
  $$ update public.revenue_records
     set account_id = current_setting('revtest.other')::uuid
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501',
  'new row violates row-level security policy for table "revenue_records"',
  'A member may not move a revenue row into an account they cannot access'
);

-- Reassigning authorship. Nothing refused this: the read policy does not look
-- at created_by, so a member could disown their own row or pin it on a
-- colleague, and the update and delete policies would then honour the new name.
set local role postgres;
select public.revenue_rls_test_reset();
select makerkit.authenticate_as('member');

select throws_ok(
  $$ update public.revenue_records set created_by = tests.get_supabase_uid('owner')
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501',
  'new row violates row-level security policy for table "revenue_records"',
  'A member may not reassign authorship of their own row'
);

set local role postgres;
select public.revenue_rls_test_reset();
select makerkit.authenticate_as('member');

select throws_ok(
  $$ update public.revenue_records set source = 'api'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501',
  'new row violates row-level security policy for table "revenue_records"',
  'A member may not launder their row into a platform-sourced one'
);

-- An owner may correct a member's entry, and doing so must not quietly take
-- the entry away from its author: `created_by` is set on insert only.
set local role postgres;
select public.revenue_rls_test_reset();
select makerkit.authenticate_as('primary_owner');

select lives_ok(
  $$ update public.revenue_records set revenue_cents = 3000
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'An account owner may correct a member entry'
);

set local role postgres;

select results_eq(
  $$ select revenue_cents, created_by from public.revenue_records
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ select 3000, tests.get_supabase_uid('member') $$,
  'The owner correction landed and left authorship with its author'
);

-- Someone outside the account entirely. Filtered rather than raised: the read
-- policy hides the row, so the update matches nothing and reports success.
-- That silent no-op is why the server action compares matched rows against
-- removed rows instead of trusting a null error.
select makerkit.authenticate_as('outsider');

select lives_ok(
  $$ update public.revenue_records set revenue_cents = 9999
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'A non-member update matches no rows rather than raising'
);

set local role postgres;

select is(
  (select revenue_cents from public.revenue_records
   where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  3000,
  'A non-member cannot change another account revenue'
);

select * from finish();

rollback;
