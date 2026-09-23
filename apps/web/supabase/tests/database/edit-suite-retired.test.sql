begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- FILM-607. The Edit Suite is retired and its code removed. Its five
-- database functions are gone (the first of them was KB-40: a SECURITY
-- DEFINER function any signed-in user could use to replace any episode's
-- edit project). Its six tables keep their rows, read-only, until the owner
-- decides (FILM-608): members still read their own rows, nobody writes, and
-- deleting a parent row still cascades.
--
-- A fixed plan, so a run that aborts early fails as a plan mismatch.
select plan(24);

-- ==================================
-- R1: the functions are gone
-- ==================================

select hasnt_function('public', 'batch_assemble_edit_project', 'R1: batch_assemble_edit_project is dropped');
select hasnt_function('public', 'batch_save_edit_project', 'R1: batch_save_edit_project is dropped');
select hasnt_function('public', 'create_edit_project_with_tracks', 'R1: create_edit_project_with_tracks is dropped');
select hasnt_function('public', 'split_edit_clip', 'R1: split_edit_clip is dropped');
select hasnt_function('public', 'get_project_id_for_edit_project', 'R1: get_project_id_for_edit_project is dropped');

-- ==================================
-- R2: no API role may write the kept tables; anon may not read them
-- ==================================

select is(
  (select count(*)::int
     from unnest(array['edit_projects', 'edit_tracks', 'edit_clips', 'edit_keyframes',
                       'edit_transitions', 'dialogue_sync_groups']) t(name),
          unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(privilege)
    where has_table_privilege('authenticated', 'public.' || t.name, p.privilege)),
  0,
  'R2: authenticated holds no INSERT, UPDATE, DELETE or TRUNCATE on any edit table'
);

select is(
  (select count(*)::int
     from unnest(array['edit_projects', 'edit_tracks', 'edit_clips', 'edit_keyframes',
                       'edit_transitions', 'dialogue_sync_groups']) t(name)
    where has_table_privilege('anon', 'public.' || t.name, 'SELECT')),
  0,
  'R2: anon cannot read any edit table'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('edit_projects', 'edit_tracks', 'edit_clips', 'edit_keyframes',
                        'edit_transitions', 'dialogue_sync_groups')
      and cmd <> 'SELECT'),
  0,
  'R2: no write policy remains on any edit table'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('edit_projects', 'edit_tracks', 'edit_clips', 'edit_keyframes',
                        'edit_transitions', 'dialogue_sync_groups')
      and cmd = 'SELECT'),
  6,
  'R2: each edit table keeps its read policy'
);

-- ==================================
-- Fixture: an owner's team project with an episode, a shot, and an edit
-- project that has a track and a clip sourced from the shot.
-- ==================================

select tests.create_supabase_user('f607_owner', 'f607-owner@storybook.dev');
select tests.create_supabase_user('f607_stranger', 'f607-stranger@storybook.dev');

select makerkit.authenticate_as('f607_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('60700000-0000-4000-8000-00000000000a', 'FILM-607 team', false, tests.get_supabase_uid('f607_owner'));

insert into public.projects (id, account_id, name, status, visibility)
values ('60700000-0000-4000-8000-000000000001', '60700000-0000-4000-8000-00000000000a', 'FILM-607 P', 'active', 'public');

insert into public.episodes (id, project_id, number, title)
values
  ('60700000-0000-4000-8000-000000000002', '60700000-0000-4000-8000-000000000001', 1, 'E'),
  ('60700000-0000-4000-8000-000000000003', '60700000-0000-4000-8000-000000000001', 2, 'E2');

insert into public.shots (id, episode_id, sequence_number, prompt)
values ('60700000-0000-4000-8000-0000000000a1', '60700000-0000-4000-8000-000000000002', 1, 'A shot');

insert into public.edit_projects (id, episode_id)
values
  ('60700000-0000-4000-8000-0000000000e1', '60700000-0000-4000-8000-000000000002'),
  ('60700000-0000-4000-8000-0000000000e2', '60700000-0000-4000-8000-000000000003');

insert into public.edit_tracks (id, edit_project_id, type, name, sort_order)
values
  ('60700000-0000-4000-8000-0000000000b1', '60700000-0000-4000-8000-0000000000e1', 'video', 'Video', 0),
  ('60700000-0000-4000-8000-0000000000b2', '60700000-0000-4000-8000-0000000000e2', 'video', 'Video', 0);

insert into public.edit_clips (id, track_id, source_shot_id, start_ms, end_ms)
values ('60700000-0000-4000-8000-0000000000c1', '60700000-0000-4000-8000-0000000000b1',
        '60700000-0000-4000-8000-0000000000a1', 0, 4000);

-- ==================================
-- R3: the owner still reads; a stranger reads nothing
-- ==================================

select makerkit.authenticate_as('f607_owner');

select is(
  (select count(*)::int from public.edit_projects
    where id in ('60700000-0000-4000-8000-0000000000e1', '60700000-0000-4000-8000-0000000000e2')),
  2,
  'R3: the account owner still reads their edit projects'
);

select is(
  (select count(*)::int from public.edit_tracks
    where edit_project_id = '60700000-0000-4000-8000-0000000000e1'),
  1,
  'R3: the account owner still reads their tracks'
);

select makerkit.authenticate_as('f607_stranger');

select is(
  (select count(*)::int from public.edit_projects
    where id in ('60700000-0000-4000-8000-0000000000e1', '60700000-0000-4000-8000-0000000000e2')),
  0,
  'R3: a stranger reads none of them'
);

-- ==================================
-- R4: nobody writes, not even the owner
-- ==================================

select makerkit.authenticate_as('f607_owner');

select throws_ok(
  $$ insert into public.edit_tracks (edit_project_id, type, name)
     values ('60700000-0000-4000-8000-0000000000e1', 'music', 'New') $$,
  '42501',
  null,
  'R4: the owner cannot insert a track'
);

select throws_ok(
  $$ update public.edit_tracks set name = 'Renamed'
      where id = '60700000-0000-4000-8000-0000000000b1' $$,
  '42501',
  null,
  'R4: the owner cannot update a track'
);

select throws_ok(
  $$ delete from public.edit_projects where id = '60700000-0000-4000-8000-0000000000e1' $$,
  '42501',
  null,
  'R4: the owner cannot delete an edit project'
);

select throws_ok(
  $$ insert into public.edit_projects (episode_id) values ('60700000-0000-4000-8000-000000000003') $$,
  '42501',
  null,
  'R4: the owner cannot create an edit project'
);

-- ==================================
-- R5–R6: referential actions from parents still run
-- ==================================

-- As the owner, through RLS: the referential actions run as the tables'
-- owner, so they must not need the write grants the owner no longer has.
select lives_ok(
  $$ delete from public.shots where id = '60700000-0000-4000-8000-0000000000a1' $$,
  'R6: the owner can still delete a shot a clip was made from'
);

select is(
  (select source_shot_id::text from public.edit_clips where id = '60700000-0000-4000-8000-0000000000c1'),
  null::text,
  'R6: deleting a shot still clears the clip''s source'
);

select lives_ok(
  $$ delete from public.episodes where id = '60700000-0000-4000-8000-000000000003' $$,
  'R5: the owner can still delete an episode that has an edit project'
);

select is(
  (select count(*)::int from public.edit_projects where id = '60700000-0000-4000-8000-0000000000e2'),
  0,
  'R5: deleting an episode still removes its edit project'
);

select is(
  (select count(*)::int from public.edit_tracks where id = '60700000-0000-4000-8000-0000000000b2'),
  0,
  'R5: and its tracks'
);

select is(
  (select count(*)::int from public.edit_projects where id = '60700000-0000-4000-8000-0000000000e1'),
  1,
  'R5: the other episode''s edit project is kept'
);

-- ==================================
-- R7: master_video is untouched (shared with the Publish page)
-- ==================================

set local role postgres;

select lives_ok(
  $$ insert into public.assets (project_id, episode_id, type, name)
     values ('60700000-0000-4000-8000-000000000001', '60700000-0000-4000-8000-000000000002',
             'master_video', 'Master') $$,
  'R7: an asset of type master_video is still accepted'
);

select has_column('public', 'episodes', 'master_video_asset_id', 'R7: episodes.master_video_asset_id is kept');

select * from finish();
rollback;
