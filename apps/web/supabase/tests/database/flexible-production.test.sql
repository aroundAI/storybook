begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(22);

-- FILM-2201. reorder_seasons and soft_delete_season run as the caller, so
-- the seasons and episodes policies decide who may use them: seasons_update
-- (project owner or admin) for both, episodes_update (member and up) for
-- moving a deleted season's episodes to Unsorted.
--
-- Fixtures: team T of fp_owner; project P (fp_owner is its owner through the
-- creator trigger); fp_member is a project member; fp_stranger is in neither.
-- Seasons A (1), B (2), C (3); episodes E1, E2 in A, E3 in B.

select tests.create_supabase_user('fp_owner', 'fp-owner@storybook.dev');
select tests.create_supabase_user('fp_member', 'fp-member@storybook.dev');
select tests.create_supabase_user('fp_stranger', 'fp-stranger@storybook.dev');

select makerkit.authenticate_as('fp_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('22010000-0000-4000-8000-00000000000a', 'FILM-2201 team', false, tests.get_supabase_uid('fp_owner'));

insert into public.projects (id, account_id, name, status)
values ('22010000-0000-4000-8000-000000000001', '22010000-0000-4000-8000-00000000000a', 'FILM-2201 P', 'active');

insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('fp_member'), '22010000-0000-4000-8000-00000000000a', 'member');

insert into public.project_members (project_id, user_id, role)
values ('22010000-0000-4000-8000-000000000001', tests.get_supabase_uid('fp_member'), 'member');

insert into public.seasons (id, project_id, number, name) values
  ('22010000-0000-4000-8000-0000000000a1', '22010000-0000-4000-8000-000000000001', 1, 'A'),
  ('22010000-0000-4000-8000-0000000000a2', '22010000-0000-4000-8000-000000000001', 2, 'B'),
  ('22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-000000000001', 3, 'C');

insert into public.episodes (id, project_id, season_id, number, title, slug) values
  ('22010000-0000-4000-8000-0000000000e1', '22010000-0000-4000-8000-000000000001', '22010000-0000-4000-8000-0000000000a1', 1, 'E1', 'e1'),
  ('22010000-0000-4000-8000-0000000000e2', '22010000-0000-4000-8000-000000000001', '22010000-0000-4000-8000-0000000000a1', 2, 'E2', 'e2'),
  ('22010000-0000-4000-8000-0000000000e3', '22010000-0000-4000-8000-000000000001', '22010000-0000-4000-8000-0000000000a2', 3, 'E3', 'e3');

-- Columns ------------------------------------------------------------------

select is(
  (select entry_mode from public.episodes where id = '22010000-0000-4000-8000-0000000000e1'),
  'idea',
  'an episode starts from an idea unless told otherwise'
);

select throws_ok(
  $$update public.episodes set entry_mode = 'import' where id = '22010000-0000-4000-8000-0000000000e1'$$,
  '23514', null,
  'entry_mode refuses a mode that does not exist'
);

select lives_ok(
  $$update public.episodes set skipped_stages = '{ideation,story}' where id = '22010000-0000-4000-8000-0000000000e1'$$,
  'skipped_stages takes stages before publish'
);

select throws_ok(
  $$update public.episodes set skipped_stages = '{publish}' where id = '22010000-0000-4000-8000-0000000000e1'$$,
  '23514', null,
  'skipped_stages refuses a stage that cannot be skipped'
);

select throws_ok(
  $$insert into public.episode_renders (episode_id, preset, language, aspect, file_path, file_size_bytes, created_by, source)
    values ('22010000-0000-4000-8000-0000000000e1', 'master', 'en', '16:9', 'k', 1, tests.get_supabase_uid('fp_owner'), 'other')$$,
  '23514', null,
  'a render comes from the studio or an upload'
);

select is(
  (select version from public.seasons where id = '22010000-0000-4000-8000-0000000000a1'),
  1,
  'a season starts at version 1'
);

-- reorder_seasons ---------------------------------------------------------

select makerkit.authenticate_as('fp_member');

select throws_ok(
  $$select public.reorder_seasons('22010000-0000-4000-8000-000000000001',
    array['22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-0000000000a1', '22010000-0000-4000-8000-0000000000a2']::uuid[])$$,
  '42501', null,
  'a project member cannot reorder seasons'
);

select makerkit.authenticate_as('fp_owner');

select results_eq(
  $$select name::text, number from public.seasons
     where project_id = '22010000-0000-4000-8000-000000000001' and deleted_at is null order by number$$,
  $$values ('A', 1), ('B', 2), ('C', 3)$$,
  'a refused reorder leaves every number where it was'
);

select throws_ok(
  $$select public.reorder_seasons('22010000-0000-4000-8000-000000000001',
    array['22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-0000000000a1']::uuid[])$$,
  '22023', null,
  'reorder refuses a list that leaves a season out'
);

select throws_ok(
  $$select public.reorder_seasons('22010000-0000-4000-8000-000000000001',
    array['22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-0000000000a1']::uuid[])$$,
  '22023', null,
  'reorder refuses a list that repeats a season'
);

select throws_ok(
  $$select public.reorder_seasons('22010000-0000-4000-8000-000000000001',
    array['22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-0000000000a1', '22010000-0000-4000-8000-0000000000e1']::uuid[])$$,
  '22023', null,
  'reorder refuses an id that is not one of the project''s seasons'
);

select results_eq(
  $$select name::text, number from public.reorder_seasons('22010000-0000-4000-8000-000000000001',
    array['22010000-0000-4000-8000-0000000000a3', '22010000-0000-4000-8000-0000000000a1', '22010000-0000-4000-8000-0000000000a2']::uuid[])$$,
  $$values ('C', 1), ('A', 2), ('B', 3)$$,
  'the owner reorders the seasons, numbered 1..n in the order given'
);

select is(
  (select version from public.seasons where id = '22010000-0000-4000-8000-0000000000a1'),
  2,
  'a reordered season moves to its next version'
);

-- soft_delete_season ------------------------------------------------------

select makerkit.authenticate_as('fp_stranger');

select throws_ok(
  $$select public.soft_delete_season('22010000-0000-4000-8000-0000000000a1', 2)$$,
  'P0002', null,
  'someone outside the account cannot see the season to delete it'
);

select makerkit.authenticate_as('fp_member');

select throws_ok(
  $$select public.soft_delete_season('22010000-0000-4000-8000-0000000000a1', 2)$$,
  '42501', null,
  'a project member cannot delete a season'
);

select makerkit.authenticate_as('fp_owner');

select throws_ok(
  $$select public.soft_delete_season('22010000-0000-4000-8000-0000000000a1', 1)$$,
  '40001', null,
  'a delete at a version that has moved on is refused'
);

select is(
  public.soft_delete_season('22010000-0000-4000-8000-0000000000a1', 2),
  2,
  'deleting a season reports the two episodes it moved'
);

set local role postgres;

select ok(
  (select deleted_at is not null from public.seasons where id = '22010000-0000-4000-8000-0000000000a1'),
  'the season is soft-deleted'
);

select results_eq(
  $$select title::text, season_id, deleted_at is null from public.episodes
     where id in ('22010000-0000-4000-8000-0000000000e1', '22010000-0000-4000-8000-0000000000e2') order by number$$,
  $$values ('E1', null::uuid, true), ('E2', null::uuid, true)$$,
  'its episodes are live and in no season: moved to Unsorted, not deleted'
);

select is(
  (select season_id from public.episodes where id = '22010000-0000-4000-8000-0000000000e3'),
  '22010000-0000-4000-8000-0000000000a2'::uuid,
  'an episode of another season stays where it was'
);

select lives_ok(
  $$insert into public.seasons (project_id, number, name)
    values ('22010000-0000-4000-8000-000000000001', 2, 'Reuses 2')$$,
  'a deleted season''s number is free again'
);

select makerkit.authenticate_as('fp_stranger');

select is(
  (select count(*)::integer from public.seasons
    where project_id = '22010000-0000-4000-8000-000000000001'),
  0,
  'the stranger reads none of the seasons'
);

select * from finish();
rollback;
