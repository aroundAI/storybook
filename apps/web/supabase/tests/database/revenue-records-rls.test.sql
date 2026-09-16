begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count, not no_plan(): an earlier draft of this file aborted a third
-- of the way through on a permissions error and still reported one failing
-- test out of four, which reads like a nearly-passing suite. With a plan, a
-- run that stops early fails as a plan mismatch instead of looking fine.
select plan(22);

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

create or replace function public.revenue_rls_test_reset_publish() returns void
  language sql security definer set search_path = '' as $fn$
  update public.revenue_records
     set revenue_cents = 1000, source = 'api', category = 'ads', created_by = null
   where id = 'bbbbbbbb-0000-4000-8000-000000000009';
  update public.revenue_records
     set revenue_cents = 2000, source = 'manual', category = 'sponsorship',
         created_by = tests.get_supabase_uid('colleague')
   where id = 'bbbbbbbb-0000-4000-8000-00000000000a';
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
  'P0001',
  'revenue_records.created_by is immutable',
  'A member may not reassign authorship of their own row'
);

-- The raise is not the property; the column is. Asserting only the message
-- would keep passing if the guard moved and started letting the write through
-- under a different error.
set local role postgres;

select is(
  (select created_by from public.revenue_records
   where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  tests.get_supabase_uid('member'),
  'Authorship is unchanged after the refusal'
);

select makerkit.authenticate_as('member');

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

-- ==================================
-- Publish-scoped rows
-- ==================================
-- Round 10 covered only the account branch, and round 11 found three holes in
-- the branch it did not cover. The publish branch is more permissive by design
-- — any project member may correct per-video revenue — which is exactly why it
-- needs its own cases rather than an assumption that the account ones
-- generalise.

set local role postgres;

-- The account owner creates the project, because the creator trigger on
-- `projects` reads auth.uid() and inserting as `postgres` makes it null.
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('bbbbbbbb-0000-4000-8000-000000000001',
          current_setting('revtest.story')::uuid, 'Revenue RLS fixture', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('bbbbbbbb-0000-4000-8000-000000000002',
          'bbbbbbbb-0000-4000-8000-000000000001', 1, 'E1', 'draft');

insert into public.publishes (id, episode_id, platform, content_type, status)
  values ('bbbbbbbb-0000-4000-8000-000000000003',
          'bbbbbbbb-0000-4000-8000-000000000002', 'youtube', 'full', 'published');

select tests.create_supabase_user('colleague', 'colleague@storybook.dev');

insert into public.project_members (project_id, user_id, role)
  values ('bbbbbbbb-0000-4000-8000-000000000001', tests.get_supabase_uid('member'), 'member'),
         ('bbbbbbbb-0000-4000-8000-000000000001', tests.get_supabase_uid('colleague'), 'member'),
         -- A seeded *account* member given the project admin role. A user who
         -- exists only in project_members cannot pass revenue_records_read,
         -- so the delete below would match nothing whatever the delete policy
         -- said — passing before and after the fix, guarding nothing.
         ('bbbbbbbb-0000-4000-8000-000000000001', tests.get_supabase_uid('owner'), 'admin')
  on conflict do nothing;

-- What the sync writes, and what a colleague hand-entered.
insert into public.revenue_records
  (id, publish_id, platform, record_date, revenue_cents, source, category)
  values ('bbbbbbbb-0000-4000-8000-000000000009',
          'bbbbbbbb-0000-4000-8000-000000000003', 'youtube', '2026-04-01', 1000, 'api', 'ads');

insert into public.revenue_records
  (id, publish_id, platform, record_date, revenue_cents, source, category, created_by)
  values ('bbbbbbbb-0000-4000-8000-00000000000a',
          'bbbbbbbb-0000-4000-8000-000000000003', 'youtube', '2026-04-02', 2000, 'manual',
          'sponsorship', tests.get_supabase_uid('colleague'));

select makerkit.authenticate_as('member');

-- A synced figure is the platform's, not a project member's. Overwriting one
-- leaves it `category = 'ads'`, so it still counts as a platform payout in the
-- ad-share signal — and since `source` joined the unique index, the next sync
-- inserts its own row beside it and the day is counted twice, for good.
set local role postgres;
select public.revenue_rls_test_reset_publish();
select makerkit.authenticate_as('member');

-- Filtered, not raised: `source = 'manual'` is in USING, so the row is never
-- selected for update and PostgREST reports a cheerful 204. The row itself is
-- the only honest assertion, which is why the next test exists.
select lives_ok(
  $$ update public.revenue_records set revenue_cents = 500000, source = 'manual'
     where id = 'bbbbbbbb-0000-4000-8000-000000000009' $$,
  'Laundering a synced row matches nothing rather than raising'
);

set local role postgres;

select is(
  (select count(*)::int from public.revenue_records
   where id = 'bbbbbbbb-0000-4000-8000-000000000009'
     and source = 'api' and revenue_cents = 1000),
  1,
  'A project member may not launder a synced row into a hand-entered one'
);

-- `deleteManualRevenueAction` filters to source = 'manual'; PostgREST does not
-- have to.
-- As a project *admin*, deliberately. A plain member is already refused by the
-- role check in the delete policy, so testing this with one would pass before
-- and after the fix and guard nothing. The `owner|admin` branch is the only
-- place the missing `source` predicate was reachable.
set local role postgres;
select public.revenue_rls_test_reset_publish();
select makerkit.authenticate_as('owner');

select lives_ok(
  $$ delete from public.revenue_records
     where id = 'bbbbbbbb-0000-4000-8000-000000000009' $$,
  'Deleting a synced row matches nothing rather than raising'
);

set local role postgres;

select is(
  (select count(*)::int from public.revenue_records
   where id = 'bbbbbbbb-0000-4000-8000-000000000009'),
  1,
  'A project admin may not delete a synced row'
);

-- Authorship on this branch. Seizing it is not merely rude: the delete policy
-- grants removal to `created_by`, so this is how a member gives themselves a
-- right that otherwise needs project owner or admin.
set local role postgres;
select public.revenue_rls_test_reset_publish();
select makerkit.authenticate_as('member');

select throws_ok(
  $$ update public.revenue_records set created_by = tests.get_supabase_uid('member')
     where id = 'bbbbbbbb-0000-4000-8000-00000000000a' $$,
  'P0001',
  'revenue_records.created_by is immutable',
  'A project member may not seize authorship of a colleague entry'
);

-- The permissiveness that is deliberate: correcting a colleague's figure is
-- allowed on this branch, and does not change who recorded it.
set local role postgres;
select public.revenue_rls_test_reset_publish();
select makerkit.authenticate_as('member');

select lives_ok(
  $$ update public.revenue_records set revenue_cents = 2500
     where id = 'bbbbbbbb-0000-4000-8000-00000000000a' $$,
  'A project member may correct a colleague per-video entry'
);

-- ==================================
-- The scope invariant is held, not promised
-- ==================================
-- `not valid` postpones the scan and nothing else: the constraint is enforced
-- on every later UPDATE of an existing row. A legacy dual-scope row therefore
-- could not be updated at all — the sync failed it with 23514 and swallowed
-- the error at warn, so that publish/date/category silently stopped being
-- recorded. 20260916050127 normalises those rows and validates the constraint;
-- these two assert the end state rather than the migration.

set local role postgres;

select is(
  (select convalidated from pg_constraint
   where conname = 'revenue_records_single_scope_check'),
  true,
  'The single-scope constraint is validated, not merely declared'
);

select is(
  (select count(*)::int from public.revenue_records
   where publish_id is not null and account_id is not null),
  0,
  'No row carries both a publish and an account scope'
);

select * from finish();

rollback;
