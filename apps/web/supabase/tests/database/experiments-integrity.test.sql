begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(22);

-- FILM-1610 review, round 2. What the table itself guarantees, so none of it
-- depends on a request having gone through the server actions:
--
--   R3  replacing an experiment's links is one transaction
--   R4  audit fields are set by the database, never by the caller
--   R5  once started, the watched metric, window and links are frozen
--   R11 `editable_publish_ids` agrees with what `publishes_update` allows
--
-- As in the other files here, foreign ids are stashed with set_config while
-- still `postgres`, because get_account_id_by_slug runs under the caller's
-- RLS and returns NULL for an account they cannot see.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select makerkit.set_identifier('custom', 'custom@storybook.dev');

select tests.create_supabase_user('viewer', 'integrity-viewer@storybook.dev');
select tests.create_supabase_user('outsider', 'integrity-outsider@storybook.dev');
select tests.create_supabase_user('other_owner', 'integrity-other@storybook.dev');

select makerkit.authenticate_as('other_owner');
select public.create_team_account('Integrity Other');

set local role postgres;

select set_config('ix.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('ix.other', makerkit.get_account_id_by_slug('integrity-other')::text, true);
select set_config('ix.member', tests.get_supabase_uid('member')::text, true);
select set_config('ix.outsider', tests.get_supabase_uid('outsider')::text, true);

-- `member` belongs to both accounts; `viewer` is an account member who is
-- only a viewer on the project; `custom` is an account member off it.
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('ix.other')::uuid, 'member'),
         (tests.get_supabase_uid('viewer'), current_setting('ix.story')::uuid, 'member');

select makerkit.authenticate_as('primary_owner');
insert into public.projects (id, account_id, name, status)
  values ('a2a2a2a2-0000-4000-8000-000000000001', current_setting('ix.story')::uuid, 'Integrity project', 'active');

select makerkit.authenticate_as('other_owner');
insert into public.projects (id, account_id, name, status)
  values ('a2a2a2a2-0000-4000-8000-000000000002', current_setting('ix.other')::uuid, 'Other project', 'active');

set local role postgres;

insert into public.project_members (project_id, user_id, role)
  values ('a2a2a2a2-0000-4000-8000-000000000001', tests.get_supabase_uid('member'), 'member'),
         ('a2a2a2a2-0000-4000-8000-000000000001', tests.get_supabase_uid('viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title, status)
  values ('a2a2a2a2-0000-4000-8000-000000000011', 'a2a2a2a2-0000-4000-8000-000000000001', 1, 'E1', 'draft'),
         ('a2a2a2a2-0000-4000-8000-000000000012', 'a2a2a2a2-0000-4000-8000-000000000002', 1, 'O1', 'draft');

insert into public.publishes (id, episode_id, platform, content_type, status)
  values ('a2a2a2a2-0000-4000-8000-000000000021', 'a2a2a2a2-0000-4000-8000-000000000011', 'youtube', 'full', 'published'),
         ('a2a2a2a2-0000-4000-8000-000000000022', 'a2a2a2a2-0000-4000-8000-000000000011', 'youtube', 'full', 'published'),
         ('a2a2a2a2-0000-4000-8000-000000000023', 'a2a2a2a2-0000-4000-8000-000000000012', 'youtube', 'full', 'published');

insert into public.analytics_experiments (id, account_id, title, change_description, status)
  values ('a2a2a2a2-0000-4000-8000-000000000031', current_setting('ix.story')::uuid, 'Planned', 'x', 'planned'),
         ('a2a2a2a2-0000-4000-8000-000000000032', current_setting('ix.story')::uuid, 'Running', 'x', 'planned');

insert into public.experiment_publishes (experiment_id, publish_id)
  values ('a2a2a2a2-0000-4000-8000-000000000031', 'a2a2a2a2-0000-4000-8000-000000000021'),
         ('a2a2a2a2-0000-4000-8000-000000000032', 'a2a2a2a2-0000-4000-8000-000000000021');

-- Started directly, the way the start action leaves it.
update public.analytics_experiments
   set status = 'running', started_at = '2026-07-01', metric_watched = 'ctr'
 where id = 'a2a2a2a2-0000-4000-8000-000000000032';

-- ==================================
-- R3: link replacement is one transaction
-- ==================================

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select public.replace_experiment_publishes(
       'a2a2a2a2-0000-4000-8000-000000000031',
       array['a2a2a2a2-0000-4000-8000-000000000022',
             'a2a2a2a2-0000-4000-8000-000000000023']::uuid[]) $$,
  '42501',
  null,
  'A replacement that includes a foreign video is refused'
);

select results_eq(
  $$ select publish_id from public.experiment_publishes
      where experiment_id = 'a2a2a2a2-0000-4000-8000-000000000031' $$,
  array['a2a2a2a2-0000-4000-8000-000000000021'::uuid],
  'and the links it would have replaced are all still there'
);

select lives_ok(
  $$ select public.replace_experiment_publishes(
       'a2a2a2a2-0000-4000-8000-000000000031',
       array['a2a2a2a2-0000-4000-8000-000000000022',
             'a2a2a2a2-0000-4000-8000-000000000022']::uuid[]) $$,
  'A valid replacement succeeds, a repeated id included'
);

select results_eq(
  $$ select publish_id from public.experiment_publishes
      where experiment_id = 'a2a2a2a2-0000-4000-8000-000000000031' $$,
  array['a2a2a2a2-0000-4000-8000-000000000022'::uuid],
  'and leaves exactly the new set, once each'
);

-- ==================================
-- R5: frozen once started
-- ==================================

select throws_ok(
  $$ update public.analytics_experiments set metric_watched = 'search_share'
      where id = 'a2a2a2a2-0000-4000-8000-000000000032' $$,
  'P0001',
  null,
  'The watched metric of a running experiment cannot change'
);

select throws_ok(
  $$ update public.analytics_experiments set review_window_days = 14
      where id = 'a2a2a2a2-0000-4000-8000-000000000032' $$,
  'P0001',
  null,
  'The review window of a running experiment cannot change'
);

select lives_ok(
  $$ update public.analytics_experiments set title = 'Renamed'
      where id = 'a2a2a2a2-0000-4000-8000-000000000032' $$,
  'Its wording still can'
);

select throws_ok(
  $$ insert into public.experiment_publishes (experiment_id, publish_id)
     values ('a2a2a2a2-0000-4000-8000-000000000032', 'a2a2a2a2-0000-4000-8000-000000000022') $$,
  '42501',
  null,
  'A video cannot be linked to a running experiment'
);

select results_eq(
  $$ with removed as (
       delete from public.experiment_publishes
        where experiment_id = 'a2a2a2a2-0000-4000-8000-000000000032'
        returning 1)
     select count(*)::int from removed $$,
  array[0],
  'and its linked videos cannot be removed'
);

-- ==================================
-- R4: audit fields come from the database
-- ==================================

select lives_ok(
  $$ update public.publishes
        set analytics_note = 'Real note',
            analytics_note_updated_by = current_setting('ix.outsider')::uuid,
            analytics_note_updated_at = '2000-01-01'
      where id = 'a2a2a2a2-0000-4000-8000-000000000021' $$,
  'A member writes a note while claiming another author and an old time'
);

set local role postgres;

select is(
  (select analytics_note_updated_by from public.publishes
    where id = 'a2a2a2a2-0000-4000-8000-000000000021'),
  current_setting('ix.member')::uuid,
  'The author recorded is the caller, not the one claimed'
);

select ok(
  (select analytics_note_updated_at > now() - interval '1 minute'
     from public.publishes where id = 'a2a2a2a2-0000-4000-8000-000000000021'),
  'The time recorded is now, not the one claimed'
);

select makerkit.authenticate_as('member');

select lives_ok(
  $$ update public.publishes
        set analytics_note_updated_by = current_setting('ix.outsider')::uuid
      where id = 'a2a2a2a2-0000-4000-8000-000000000021' $$,
  'Rewriting only the author, with the note unchanged, is accepted'
);

set local role postgres;

select is(
  (select analytics_note_updated_by from public.publishes
    where id = 'a2a2a2a2-0000-4000-8000-000000000021'),
  current_setting('ix.member')::uuid,
  'but leaves the real author in place'
);

select makerkit.authenticate_as('member');

insert into public.analytics_experiments (id, account_id, title, change_description, created_by)
  values ('a2a2a2a2-0000-4000-8000-000000000033', current_setting('ix.story')::uuid,
          'Claimed author', 'x', current_setting('ix.outsider')::uuid);

set local role postgres;

select is(
  (select created_by from public.analytics_experiments
    where id = 'a2a2a2a2-0000-4000-8000-000000000033'),
  current_setting('ix.member')::uuid,
  'An experiment''s creator is the caller, not the one claimed'
);

-- F3: and it stays theirs. The update policy allows any column, so without
-- a guard on update a member could rewrite who created an experiment later.
select makerkit.authenticate_as('member');

update public.analytics_experiments
   set created_by = current_setting('ix.outsider')::uuid
 where id = 'a2a2a2a2-0000-4000-8000-000000000033';

set local role postgres;

select is(
  (select created_by from public.analytics_experiments
    where id = 'a2a2a2a2-0000-4000-8000-000000000033'),
  current_setting('ix.member')::uuid,
  'An experiment''s creator cannot be rewritten by a later update'
);


-- ==================================
-- R11: editable_publish_ids agrees with publishes_update
-- ==================================
-- Each user's answer from the function is compared with an update that
-- changes nothing: the policy, not a reading of it, is the reference.

create function pg_temp.agrees() returns boolean language plpgsql as $$
declare
  by_function int;
  by_policy int;
begin
  select count(*) into by_function
    from public.editable_publish_ids(array['a2a2a2a2-0000-4000-8000-000000000021']::uuid[]);

  update public.publishes set analytics_note = analytics_note
   where id = 'a2a2a2a2-0000-4000-8000-000000000021';
  get diagnostics by_policy = row_count;

  return by_function = by_policy;
end;
$$;

-- Created as postgres; the users below run it.
grant execute on function pg_temp.agrees() to authenticated;

select makerkit.authenticate_as('member');
select ok(pg_temp.agrees(), 'Project member: the function and the policy agree (can edit)');

select makerkit.authenticate_as('viewer');
select ok(pg_temp.agrees(), 'Project viewer: they agree (cannot edit)');

select makerkit.authenticate_as('custom');
select ok(pg_temp.agrees(), 'Account member off the project: they agree (cannot edit)');

select makerkit.authenticate_as('outsider');
select ok(pg_temp.agrees(), 'Outsider: they agree (cannot edit)');

-- ==================================
-- Last, because it removes a user the tests above sign in as
-- ==================================

set local role postgres;
-- Deleting the user who created an experiment must still work, and keep the
-- experiment: it belongs to the account, not to whoever typed it in.
select lives_ok(
  $$ delete from auth.users where id = current_setting('ix.member')::uuid $$,
  'The creator of an experiment can still be deleted'
);

select is(
  (select created_by from public.analytics_experiments
    where id = 'a2a2a2a2-0000-4000-8000-000000000033'),
  null,
  'and the experiment stays, with no creator'
);

select * from finish();

rollback;
