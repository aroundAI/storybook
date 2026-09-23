begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(13);

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

-- The start date is set while the experiment stays planned: the due date is
-- generated from started_at whatever the status, and a *running*
-- experiment's window is frozen (experiments-integrity.test.sql), so the
-- window cases below need one that has not started.
--
-- No user can produce that state — only the start sets started_at, and it
-- sets the status with it (experiments-lifecycle.test.sql) — so it is
-- written the way a seed would, as the service role.
select tests.clear_authentication();
set local role service_role;

update public.analytics_experiments
   set started_at = '2026-07-01'
 where id = 'e0e0e0e0-0000-4000-8000-00000000000a';

select makerkit.authenticate_as('member');

select is(
  (select review_due_at from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  '2026-08-30'::date,
  'A start date makes it due started_at + review_window_days later'
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

select throws_ok(
  $$ update public.analytics_experiments set notes = repeat('x', 5001)
      where id = 'e0e0e0e0-0000-4000-8000-00000000000a' $$,
  '23514',
  null,
  'Experiment notes over 5,000 characters are refused by the table'
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
-- KB-22: a disconnect no longer deletes the connection row (it used to, and
-- this key's `on delete set null` then cut the experiment loose from its
-- channel). The row stays, so the experiment keeps its channel.

set local role postgres;

select public.disconnect_platform_connection('e0e0e0e0-0000-4000-8000-000000000001');

select is(
  (select connection_id from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  'e0e0e0e0-0000-4000-8000-000000000001'::uuid,
  'Disconnecting the channel keeps it as the experiment''s channel'
);

-- The key's referential action, still worth holding: `set null
-- (connection_id)`, never a bare `set null`, which would also null
-- account_id and orphan the experiment from its account. Only account
-- deletion removes a connection now (platform_connections_refuse_delete),
-- so the guard is lifted here, inside this rolled-back test, to reach it.
alter table public.platform_connections disable trigger platform_connections_refuse_delete;

delete from public.platform_connections
 where id = 'e0e0e0e0-0000-4000-8000-000000000001';

select is(
  (select connection_id from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  null,
  'Deleting the channel row nulls connection_id'
);

select is(
  (select account_id from public.analytics_experiments
    where id = 'e0e0e0e0-0000-4000-8000-00000000000a'),
  current_setting('exp.story')::uuid,
  'and leaves the experiment and its account intact'
);

select * from finish();

rollback;
