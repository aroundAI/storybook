begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count rather than no_plan(): a file that aborts partway through
-- still reports the tests it managed to run, which reads like a nearly-
-- passing suite. With a plan, stopping early is a plan mismatch.
select plan(21);

-- FILM-1608. Two tables are exercised here:
--
--   channel_analytics_settings — new, per-channel YPP overrides
--   analytics_settings         — existing, altered to make its targets nullable
--
-- Both grant select/insert/update to `authenticated` and deliberately no
-- delete. Reset-to-default is writing null; nothing removes a row, because a
-- delete would also discard the applicant status and joined date sitting
-- beside the targets.
--
-- The trap from `revenue-records-rls.test.sql` applies here too:
-- `makerkit.get_account_id_by_slug` runs under the caller's own RLS, so asking
-- it for an account the caller cannot see returns NULL and silently turns a
-- cross-tenant case into a null-scope case. Foreign ids are stashed with
-- `set_config` while still `postgres`.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

-- A second team the `storybook` member has no access to at all.
select tests.create_supabase_user('outsider', 'outsider@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('Other Co');

set local role postgres;

select set_config('cas.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('cas.other', makerkit.get_account_id_by_slug('other-co')::text, true);

-- Connections are created as postgres: this file is about the settings
-- policies, and driving `platform_connections`' own policies here would make
-- a failure ambiguous between the two tables.
insert into public.platform_connections (id, account_id, platform, platform_account_name)
values
  ('c0ffee11-0000-4000-8000-000000000001',
   current_setting('cas.story')::uuid, 'youtube', 'Story Channel'),
  ('c0ffee11-0000-4000-8000-000000000002',
   current_setting('cas.other')::uuid, 'youtube', 'Outsider Channel');

-- ==================================
-- Insert
-- ==================================

select makerkit.authenticate_as('member');

select lives_ok(
  $$ insert into public.channel_analytics_settings
       (connection_id, account_id, ypp_target_watch_hours, ypp_applicant_status)
     values ('c0ffee11-0000-4000-8000-000000000001',
             current_setting('cas.story')::uuid, 8000, 'new_applicant') $$,
  'A member may set a per-channel override on their own account'
);

select is(
  (select ypp_target_subscribers from public.channel_analytics_settings
   where connection_id = 'c0ffee11-0000-4000-8000-000000000001'),
  null,
  'An untouched target column is null, meaning inherit, not zero'
);

-- The account_id is denormalised, so the policy authorises on a value the
-- caller supplies. If that were unchecked, a member could file an override
-- under a tenant they cannot reach.
select throws_ok(
  $$ insert into public.channel_analytics_settings (connection_id, account_id)
     values ('c0ffee11-0000-4000-8000-000000000002',
             current_setting('cas.other')::uuid) $$,
  '42501',
  'new row violates row-level security policy for table "channel_analytics_settings"',
  'A member may not create an override against an account they cannot access'
);

select throws_ok(
  $$ insert into public.channel_analytics_settings
       (connection_id, account_id, ypp_applicant_status)
     values ('c0ffee11-0000-4000-8000-000000000002',
             current_setting('cas.story')::uuid, 'not_a_status') $$,
  '23514',
  'new row for relation "channel_analytics_settings" violates check constraint "channel_analytics_settings_status_check"',
  'The status check constraint admits only the three documented values'
);

-- ==================================
-- Update
-- ==================================

select lives_ok(
  $$ update public.channel_analytics_settings set ypp_target_watch_hours = 6000
     where connection_id = 'c0ffee11-0000-4000-8000-000000000001' $$,
  'A member may change an override on their own account'
);

select lives_ok(
  $$ update public.channel_analytics_settings set ypp_target_watch_hours = null
     where connection_id = 'c0ffee11-0000-4000-8000-000000000001' $$,
  'Clearing an override writes null rather than deleting the row'
);

set local role postgres;

select is(
  (select ypp_target_watch_hours from public.channel_analytics_settings
   where connection_id = 'c0ffee11-0000-4000-8000-000000000001'),
  null,
  'The cleared override really is null'
);

-- Proving the timestamp trigger fires needs a stale value planted first.
-- `trigger_set_timestamps` writes `now()`, which is transaction time, and
-- pgTAP runs the whole file in one transaction — so created_at and updated_at
-- are equal no matter whether the trigger exists, and comparing them tests
-- nothing. The first draft of this case did exactly that and failed.
alter table public.channel_analytics_settings
  disable trigger set_channel_analytics_settings_timestamp;

update public.channel_analytics_settings
   set updated_at = '2020-01-01T00:00:00Z'
 where connection_id = 'c0ffee11-0000-4000-8000-000000000001';

alter table public.channel_analytics_settings
  enable trigger set_channel_analytics_settings_timestamp;

select makerkit.authenticate_as('member');

select lives_ok(
  $$ update public.channel_analytics_settings set ypp_target_subscribers = 1500
     where connection_id = 'c0ffee11-0000-4000-8000-000000000001' $$,
  'A member may set a second override on the same row'
);

set local role postgres;

select is(
  (select updated_at from public.channel_analytics_settings
   where connection_id = 'c0ffee11-0000-4000-8000-000000000001'),
  now(),
  'The timestamp trigger overwrote a stale updated_at on update'
);

select makerkit.authenticate_as('member');

-- What actually refuses this is the SELECT policy, not the UPDATE policy's
-- WITH CHECK. Postgres applies the read policy to the row an UPDATE produces,
-- and `channel_analytics_settings_read` tests `has_account_access` on the new
-- account_id. Measured, not reasoned: widening the WITH CHECK to `true` alone
-- leaves this case green; widening the read policy as well turns it red.
--
-- The case is kept because the refusal is what matters and it is worth
-- guarding whichever clause delivers it — but the comment says which one
-- does, so nobody "fixes" the read policy later believing the WITH CHECK has
-- this covered.
select throws_ok(
  $$ update public.channel_analytics_settings
       set account_id = current_setting('cas.other')::uuid
     where connection_id = 'c0ffee11-0000-4000-8000-000000000001' $$,
  '42501',
  'new row violates row-level security policy for table "channel_analytics_settings"',
  'An override may not be repointed at an account the caller cannot access'
);

-- ==================================
-- Delete is not granted at all
-- ==================================

select throws_ok(
  $$ delete from public.channel_analytics_settings
     where connection_id = 'c0ffee11-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table channel_analytics_settings',
  'authenticated has no delete grant on channel_analytics_settings'
);

select throws_ok(
  $$ delete from public.analytics_settings
     where account_id = current_setting('cas.story')::uuid $$,
  '42501',
  'permission denied for table analytics_settings',
  'authenticated has no delete grant on analytics_settings either'
);

-- ==================================
-- Cross-tenant read
-- ==================================

set local role postgres;

insert into public.channel_analytics_settings (connection_id, account_id, ypp_target_watch_hours)
values ('c0ffee11-0000-4000-8000-000000000002',
        current_setting('cas.other')::uuid, 12000);

select makerkit.authenticate_as('member');

select is(
  (select count(*)::int from public.channel_analytics_settings
   where connection_id = 'c0ffee11-0000-4000-8000-000000000002'),
  0,
  'A member cannot read another account''s channel override'
);

select is(
  (select count(*)::int from public.channel_analytics_settings),
  1,
  'Only the caller''s own override is visible in an unfiltered read'
);

-- ==================================
-- analytics_settings accepts the nulls the ALTER made possible
-- ==================================

select lives_ok(
  $$ insert into public.analytics_settings (account_id) values
       (current_setting('cas.story')::uuid) $$,
  'An account settings row may be created with no targets set'
);

select is(
  (select ypp_target_watch_hours from public.analytics_settings
   where account_id = current_setting('cas.story')::uuid),
  null,
  'The account target is null rather than defaulting to 4000'
);

-- The same trigger, on the older table. `analytics_settings` shipped without
-- one, so its updated_at had only ever been the insert default — nobody
-- noticed because the table had no writer until now. Planted stale, for the
-- transaction-clock reason above.
set local role postgres;

alter table public.analytics_settings
  disable trigger set_analytics_settings_timestamp;

update public.analytics_settings
   set updated_at = '2020-01-01T00:00:00Z'
 where account_id = current_setting('cas.story')::uuid;

alter table public.analytics_settings
  enable trigger set_analytics_settings_timestamp;

select makerkit.authenticate_as('member');

select lives_ok(
  $$ update public.analytics_settings set tag_min_sample = 9
     where account_id = current_setting('cas.story')::uuid $$,
  'A member may change the account-wide tag sample threshold'
);

set local role postgres;

select is(
  (select updated_at from public.analytics_settings
   where account_id = current_setting('cas.story')::uuid),
  now(),
  'analytics_settings now advances updated_at too'
);

select makerkit.authenticate_as('member');

-- ==================================
-- Cascades
-- ==================================
-- `on delete cascade` on both foreign keys, run as postgres because this is
-- about the referential action rather than a policy. Worth proving rather
-- than assuming: in FILM-1609 a referential action fired a row trigger that a
-- new guard rejected, and every account with one revenue row became
-- undeletable — including through account deletion.

set local role postgres;

delete from public.platform_connections
where id = 'c0ffee11-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.channel_analytics_settings
   where connection_id = 'c0ffee11-0000-4000-8000-000000000001'),
  0,
  'Deleting a channel takes its override with it'
);

select lives_ok(
  $$ delete from public.accounts where id = current_setting('cas.other')::uuid $$,
  'An account with analytics overrides can still be deleted'
);

select is(
  (select count(*)::int from public.channel_analytics_settings
   where account_id = current_setting('cas.other')::uuid),
  0,
  'Deleting an account takes its channel overrides with it'
);

select * from finish();

rollback;
