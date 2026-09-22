begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(9);

-- FILM-1710. `publishes.duration_seconds` is a measurement taken from the
-- platform, with one writer: the analytics sync, on the service role.
-- `publishes_update` lets a project member write any column, so the rule is
-- held by `publishes_keep_asset_duration` rather than by a policy. A trigger
-- that decides by who is asking is exactly the kind of thing that reads
-- correct and is not — the first draft keyed on `auth.role()` and this file
-- showed a member's write going straight through — so it is exercised here
-- from both sides.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

set local role postgres;

select set_config('dur.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- The account owner creates the project: the creator trigger on `projects`
-- reads auth.uid(), which is null when inserting as postgres.
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('d1d1d1d1-0000-4000-8000-000000000001',
          current_setting('dur.story')::uuid, 'Asset duration fixture', 'active');

select tests.clear_authentication();
set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('d1d1d1d1-0000-4000-8000-000000000002',
          'd1d1d1d1-0000-4000-8000-000000000001', 1, 'E1', 'draft');

insert into public.publishes (id, episode_id, platform, content_type, status)
  values ('d1d1d1d1-0000-4000-8000-000000000003',
          'd1d1d1d1-0000-4000-8000-000000000002', 'youtube', 'short', 'published');

insert into public.project_members (project_id, user_id, role)
  values ('d1d1d1d1-0000-4000-8000-000000000001', tests.get_supabase_uid('member'), 'member');

-- ==================================
-- Absence is the default, and it is null
-- ==================================

select is(
  (select duration_seconds from public.publishes
    where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  null,
  'A publish starts with no asset duration: null, not 0'
);

-- ==================================
-- The sync (service role) writes it
-- ==================================

select tests.authenticate_as_service_role();

update public.publishes set duration_seconds = 45
 where id = 'd1d1d1d1-0000-4000-8000-000000000003';

select tests.clear_authentication();
set local role postgres;

select is(
  (select duration_seconds from public.publishes
    where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  45,
  'The service role writes the asset duration'
);

-- ==================================
-- A project member cannot change it, and the rest of their write lands
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ with updated as (
       update public.publishes
          set duration_seconds = 1320, title = 'Retitled by a member'
        where id = 'd1d1d1d1-0000-4000-8000-000000000003'
        returning 1)
     select count(*)::int from updated $$,
  array[1],
  'A member''s update that carries the column is not refused — so the next two are not vacuous'
);

select tests.clear_authentication();
set local role postgres;

select is(
  (select duration_seconds from public.publishes
    where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  45,
  'and the duration is unchanged: a browser session is not its writer'
);

select is(
  (select title::text from public.publishes
    where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  'Retitled by a member',
  'while the columns a member does own were written'
);

select makerkit.authenticate_as('member');

update public.publishes set duration_seconds = null
 where id = 'd1d1d1d1-0000-4000-8000-000000000003';

select tests.clear_authentication();
set local role postgres;

select is(
  (select duration_seconds from public.publishes
    where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  45,
  'A member cannot clear it either'
);

-- ==================================
-- Nor plant one on insert
-- ==================================

select makerkit.authenticate_as('member');

insert into public.publishes (id, episode_id, platform, content_type, status, duration_seconds)
  values ('d1d1d1d1-0000-4000-8000-000000000004',
          'd1d1d1d1-0000-4000-8000-000000000002', 'tiktok', 'short', 'draft', 1320);

select tests.clear_authentication();
set local role postgres;

select results_eq(
  $$ select count(*)::int, count(duration_seconds)::int from public.publishes
      where id = 'd1d1d1d1-0000-4000-8000-000000000004' $$,
  $$ values (1, 0) $$,
  'A member''s insert lands, with the duration it tried to supply dropped'
);

-- ==================================
-- Zero is not a duration
-- ==================================

select throws_ok(
  $$ update public.publishes set duration_seconds = 0
      where id = 'd1d1d1d1-0000-4000-8000-000000000003' $$,
  '23514',
  null,
  'A zero duration is refused by the table: 0 is how unknown used to be spelled'
);

select throws_ok(
  $$ update public.publishes set duration_seconds = -5
      where id = 'd1d1d1d1-0000-4000-8000-000000000003' $$,
  '23514',
  null,
  'and so is a negative one'
);

select * from finish();

rollback;
