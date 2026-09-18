begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(11);

-- FILM-1610. The columns added to `analytics_experiments`: a generated review
-- date that nobody can write, a review window the table itself bounds, and a
-- channel that must belong to the experiment's own account.
--
-- The trap from `revenue-records-rls.test.sql` applies: resolving another
-- team's slug as a user returns NULL under RLS, so foreign ids are stashed
-- with `set_config` while still `postgres`.

select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('outsider', 'outsider@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('Other Co');

set local role postgres;

select set_config('exp.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('exp.other', makerkit.get_account_id_by_slug('other-co')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_name)
values
  ('e0e0e0e0-0000-4000-8000-000000000001',
   current_setting('exp.story')::uuid, 'youtube', 'Story Channel'),
  ('e0e0e0e0-0000-4000-8000-000000000002',
   current_setting('exp.other')::uuid, 'youtube', 'Outsider Channel');

select makerkit.authenticate_as('member');

-- ==================================
-- review_due_at is derived, never written
-- ==================================

select throws_ok(
  $$ insert into public.analytics_experiments
       (account_id, title, change_description, review_due_at)
     values (current_setting('exp.story')::uuid, 'Direct due date', 'x', '2026-01-01') $$,
  '428C9',
  null,
  'review_due_at cannot be written directly'
);

insert into public.analytics_experiments (id, account_id, title, change_description)
  values ('e0e0e0e0-0000-4000-8000-00000000000a',
          current_setting('exp.story')::uuid, 'Shorter cold open', 'Cut intro to 5s');

-- Existing rows got their window from the column default when the migration
-- added it (ADD COLUMN ... NOT NULL DEFAULT fills every row); a row written
-- without one gets it the same way.
select is(
  (select review_window_days from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  60,
  'An experiment written without a window gets 60 days'
);

select is(
  (select review_due_at from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  null,
  'A planned experiment is not due for anything'
);

update public.analytics_experiments
   set status = 'running', started_at = '2026-07-01'
 where id = 'e0e0e0e0-0000-4000-8000-00000000000a';

select is(
  (select review_due_at from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  '2026-08-30'::date,
  'Starting an experiment makes it due started_at + review_window_days later'
);

update public.analytics_experiments
   set review_window_days = 14
 where id = 'e0e0e0e0-0000-4000-8000-00000000000a';

select is(
  (select review_due_at from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  '2026-07-15'::date,
  'Changing the window moves the due date with it'
);

-- ==================================
-- The window is bounded by the table, not only by zod
-- ==================================

select throws_ok(
  $$ update public.analytics_experiments set review_window_days = 0
      where id = 'e0e0e0e0-0000-4000-8000-00000000000a' $$,
  '23514',
  null,
  'A zero-day window is refused'
);

select throws_ok(
  $$ update public.analytics_experiments set review_window_days = 366
      where id = 'e0e0e0e0-0000-4000-8000-00000000000a' $$,
  '23514',
  null,
  'A window over a year is refused'
);

-- ==================================
-- The channel belongs to the experiment's own account
-- ==================================

select throws_ok(
  $$ update public.analytics_experiments
        set connection_id = 'e0e0e0e0-0000-4000-8000-000000000002'
      where id = 'e0e0e0e0-0000-4000-8000-00000000000a' $$,
  '23503',
  null,
  'Another account''s channel cannot be attached to an experiment'
);

select lives_ok(
  $$ update public.analytics_experiments
        set connection_id = 'e0e0e0e0-0000-4000-8000-000000000001'
      where id = 'e0e0e0e0-0000-4000-8000-00000000000a' $$,
  'The account''s own channel can be attached'
);

-- ==================================
-- Disconnecting the channel keeps the experiment
-- ==================================

set local role postgres;

delete from public.platform_connections
 where id = 'e0e0e0e0-0000-4000-8000-000000000001';

select is(
  (select connection_id from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  null,
  'Deleting the channel nulls connection_id'
);

select is(
  (select account_id from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  current_setting('exp.story')::uuid,
  'and leaves the experiment and its account intact'
);

select * from finish();

rollback;
