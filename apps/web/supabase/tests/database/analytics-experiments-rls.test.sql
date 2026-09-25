begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(12);

-- Who can read, change and delete a Change log entry.
--
-- FILM-1509's criterion "a second account's user cannot read or modify" had
-- only ever been claimed from the policy text; this runs it. And the
-- delete scope the owner decided with KB-7 (2026-09-24): an entry can be
-- deleted only while planned or abandoned. A running entry is abandoned
-- first; a concluded one is the record the log exists to keep.

select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('stranger', 'stranger@storybook.dev');

set local role postgres;

select set_config('ae.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- Seeded with no session, so the lifecycle guard lets each state be written
-- directly (as seeds do); every assertion below runs as a signed-in user.
insert into public.analytics_experiments
  (id, account_id, title, change_description, status, started_at, ended_at, outcome_status)
values
  ('a5a5a5a5-0000-4000-8000-000000000001', current_setting('ae.story')::uuid, 'Planned', 'x', 'planned', null, null, 'pending'),
  ('a5a5a5a5-0000-4000-8000-000000000002', current_setting('ae.story')::uuid, 'Running', 'x', 'running', '2026-09-01', null, 'pending'),
  ('a5a5a5a5-0000-4000-8000-000000000003', current_setting('ae.story')::uuid, 'Concluded', 'x', 'concluded', '2026-08-01', '2026-09-01', 'confirmed'),
  ('a5a5a5a5-0000-4000-8000-000000000004', current_setting('ae.story')::uuid, 'Abandoned', 'x', 'abandoned', null, '2026-09-01', 'inconclusive');

-- ==================================
-- Someone outside the account
-- ==================================

select makerkit.authenticate_as('stranger');

select results_eq(
  $$ select count(*)::int from public.analytics_experiments
      where account_id = current_setting('ae.story')::uuid $$,
  array[0],
  'An outsider reads none of the account''s changes'
);

select results_eq(
  $$ with changed as (
       update public.analytics_experiments set title = 'Hijacked'
        where id = 'a5a5a5a5-0000-4000-8000-000000000001'
       returning 1)
     select count(*)::int from changed $$,
  array[0],
  'An outsider''s update matches nothing'
);

select results_eq(
  $$ with removed as (
       delete from public.analytics_experiments
        where id = 'a5a5a5a5-0000-4000-8000-000000000001'
       returning 1)
     select count(*)::int from removed $$,
  array[0],
  'An outsider''s delete matches nothing'
);

select throws_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description)
     values (current_setting('ae.story')::uuid, 'Planted', 'x') $$,
  '42501',
  null,
  'An outsider cannot add a change to the account'
);

set local role postgres;

select results_eq(
  $$ select title from public.analytics_experiments
      where id = 'a5a5a5a5-0000-4000-8000-000000000001' $$,
  array['Planned'::varchar],
  'The outsider changed nothing'
);

select results_eq(
  $$ select count(*)::int from public.analytics_experiments
      where account_id = current_setting('ae.story')::uuid $$,
  array[4],
  'and deleted nothing'
);

-- ==================================
-- A member: delete only while planned or abandoned
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ with removed as (
       delete from public.analytics_experiments
        where id = 'a5a5a5a5-0000-4000-8000-000000000002'
       returning 1)
     select count(*)::int from removed $$,
  array[0],
  'A running change cannot be deleted; it is abandoned first'
);

select results_eq(
  $$ with removed as (
       delete from public.analytics_experiments
        where id = 'a5a5a5a5-0000-4000-8000-000000000003'
       returning 1)
     select count(*)::int from removed $$,
  array[0],
  'A concluded change cannot be deleted'
);

select results_eq(
  $$ with removed as (
       delete from public.analytics_experiments
        where id = 'a5a5a5a5-0000-4000-8000-000000000001'
       returning 1)
     select count(*)::int from removed $$,
  array[1],
  'A planned change can be deleted'
);

select results_eq(
  $$ with removed as (
       delete from public.analytics_experiments
        where id = 'a5a5a5a5-0000-4000-8000-000000000004'
       returning 1)
     select count(*)::int from removed $$,
  array[1],
  'An abandoned change can be deleted'
);

select results_eq(
  $$ select title from public.analytics_experiments
      where account_id = current_setting('ae.story')::uuid
      order by title $$,
  array['Concluded'::varchar, 'Running'::varchar],
  'The running and concluded changes are still there'
);

-- A member can still edit a concluded change's wording: deletion is scoped,
-- editing is not (the lifecycle guard decides which fields).
select results_eq(
  $$ with changed as (
       update public.analytics_experiments set title = 'Concluded, retitled'
        where id = 'a5a5a5a5-0000-4000-8000-000000000003'
       returning 1)
     select count(*)::int from changed $$,
  array[1],
  'A member can retitle a concluded change'
);

select * from finish();

rollback;
