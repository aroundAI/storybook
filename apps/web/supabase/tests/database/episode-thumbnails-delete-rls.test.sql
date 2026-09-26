begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- KB-89 / KB-61. episode_thumbnails' delete policy admitted owners and admins
-- only, while members could add and replace thumbnails and the action let
-- them delete. A member's delete matched no row — PostgREST reports that as
-- success — after the action had already deleted the file. Owner decision
-- 2026-09-25: members may remove thumbnails; the policy follows
-- can_write_project like the table's other writes.
--
-- Actors, on team project XT:
--   kb89_owner   creates XT, so project owner       -> deletes
--   kb89_admin   project admin                      -> deletes
--   kb89_member  project member                     -> deletes (was refused)
--   kb89_viewer  project viewer                     -> refused
--   kb89_off     team member, not on the project    -> refused
--   kb89_out     another account entirely           -> refused
--
-- Every case deletes a freshly inserted row, so no case depends on another.

select tests.create_supabase_user('kb89_owner', 'kb89-owner@storybook.dev');
select tests.create_supabase_user('kb89_admin', 'kb89-admin@storybook.dev');
select tests.create_supabase_user('kb89_member', 'kb89-member@storybook.dev');
select tests.create_supabase_user('kb89_viewer', 'kb89-viewer@storybook.dev');
select tests.create_supabase_user('kb89_off', 'kb89-off@storybook.dev');
select tests.create_supabase_user('kb89_out', 'kb89-out@storybook.dev');

create function pg_temp.affected(q text) returns integer
language plpgsql as $$
declare n integer;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function pg_temp.affected(text) to authenticated;

-- A fresh thumbnail row, written as postgres; returns nothing
create function pg_temp.fresh_thumbnail() returns void
language sql as $$
  delete from public.episode_thumbnails
    where id = '8989a000-0000-4000-8000-000000000021';
  insert into public.episode_thumbnails (id, episode_id, language, thumbnail_url)
    values ('8989a000-0000-4000-8000-000000000021',
            '8989a000-0000-4000-8000-000000000011', 'en',
            'https://x.invalid/episodes/8989a000-0000-4000-8000-000000000011/thumbnails/en-1.png');
$$;

select makerkit.authenticate_as('kb89_owner');
set local role postgres;
select set_config('t.team', makerkit.get_account_id_by_slug('storybook')::text, true);
insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('kb89_owner'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb89_admin'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb89_member'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb89_viewer'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb89_off'), current_setting('t.team')::uuid, 'member');
insert into public.projects (id, account_id, name, status) values
  ('8989a000-0000-4000-8000-000000000001', current_setting('t.team')::uuid, 'KB-89 team', 'active');
insert into public.project_members (project_id, user_id, role) values
  ('8989a000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb89_admin'), 'admin'),
  ('8989a000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb89_member'), 'member'),
  ('8989a000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb89_viewer'), 'viewer');
insert into public.episodes (id, project_id, number, title) values
  ('8989a000-0000-4000-8000-000000000011', '8989a000-0000-4000-8000-000000000001', 1, 'KB-89');

select is(
  (select role::text from public.project_members
    where project_id = '8989a000-0000-4000-8000-000000000001'
      and user_id = tests.get_supabase_uid('kb89_owner')),
  'owner',
  'fixture: the creator is the project owner'
);

-- ------------------------------------------------------------------
-- Allowed: owner, admin, member
-- ------------------------------------------------------------------
set local role postgres;
select pg_temp.fresh_thumbnail();
select makerkit.authenticate_as('kb89_owner');
select is(
  pg_temp.affected($q$delete from public.episode_thumbnails where id = '8989a000-0000-4000-8000-000000000021'$q$),
  1, 'the project owner removes a thumbnail'
);

set local role postgres;
select pg_temp.fresh_thumbnail();
select makerkit.authenticate_as('kb89_admin');
select is(
  pg_temp.affected($q$delete from public.episode_thumbnails where id = '8989a000-0000-4000-8000-000000000021'$q$),
  1, 'a project admin removes a thumbnail'
);

set local role postgres;
select pg_temp.fresh_thumbnail();
select makerkit.authenticate_as('kb89_member');
select is(
  pg_temp.affected($q$delete from public.episode_thumbnails where id = '8989a000-0000-4000-8000-000000000021'$q$),
  1, 'a project member removes a thumbnail (KB-89: was refused, with no error)'
);

-- ------------------------------------------------------------------
-- Refused: viewer, a team member not on the project, an outsider
-- ------------------------------------------------------------------
set local role postgres;
select pg_temp.fresh_thumbnail();
select makerkit.authenticate_as('kb89_viewer');
select is(
  pg_temp.affected($q$delete from public.episode_thumbnails where id = '8989a000-0000-4000-8000-000000000021'$q$),
  0, 'a project viewer cannot remove a thumbnail'
);

select makerkit.authenticate_as('kb89_off');
select is(
  pg_temp.affected($q$delete from public.episode_thumbnails where id = '8989a000-0000-4000-8000-000000000021'$q$),
  0, 'a team member who is not on the project cannot remove a thumbnail'
);

select makerkit.authenticate_as('kb89_out');
select is(
  pg_temp.affected($q$delete from public.episode_thumbnails where id = '8989a000-0000-4000-8000-000000000021'$q$),
  0, 'someone from another account cannot remove a thumbnail'
);

set local role postgres;
select is(
  (select count(*)::int from public.episode_thumbnails
    where id = '8989a000-0000-4000-8000-000000000021'),
  1, 'the refused removals left the row in place'
);

select * from finish();

rollback;
