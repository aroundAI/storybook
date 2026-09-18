begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(12);

-- FILM-1610. `publishes.analytics_note` adds no policy: the existing
-- `publishes_update` policy decides who may write a note — owner, admin or
-- member of the publish's *project*. Reading a publish needs only a role on
-- the *account*, so there are people who can see a note and not change it.
-- That gap is deliberate (the same rule as editing the publish), and this
-- file is what makes it a fact rather than a reading of the policy.
--
-- Every refusal below is paired with a proof that the same user can *read*
-- the publish. Without it, "0 rows updated" would pass just as well for a
-- user the row is invisible to, and would guard nothing.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select makerkit.set_identifier('custom', 'custom@storybook.dev');

select tests.create_supabase_user('viewer', 'viewer@storybook.dev');
select tests.create_supabase_user('outsider', 'outsider@storybook.dev');

set local role postgres;

select set_config('note.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- The viewer belongs to the account, so the only thing standing between them
-- and the note is their project role.
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('viewer'), current_setting('note.story')::uuid, 'member');

-- The account owner creates the project: the creator trigger on `projects`
-- reads auth.uid(), which is null when inserting as postgres.
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('d0d0d0d0-0000-4000-8000-000000000001',
          current_setting('note.story')::uuid, 'Note RLS fixture', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('d0d0d0d0-0000-4000-8000-000000000002',
          'd0d0d0d0-0000-4000-8000-000000000001', 1, 'E1', 'draft');

insert into public.publishes (id, episode_id, platform, content_type, status)
  values ('d0d0d0d0-0000-4000-8000-000000000003',
          'd0d0d0d0-0000-4000-8000-000000000002', 'youtube', 'full', 'published');

-- `custom` is an account member (custom-role) and is left off the project.
insert into public.project_members (project_id, user_id, role)
  values ('d0d0d0d0-0000-4000-8000-000000000001', tests.get_supabase_uid('member'), 'member'),
         ('d0d0d0d0-0000-4000-8000-000000000001', tests.get_supabase_uid('viewer'), 'viewer');

-- ==================================
-- A project member writes the note
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ with updated as (
       update public.publishes
          set analytics_note = 'Thumbnail swapped on day 3',
              analytics_note_updated_at = now(),
              analytics_note_updated_by = auth.uid()
        where id = 'd0d0d0d0-0000-4000-8000-000000000003'
        returning 1)
     select count(*)::int from updated $$,
  array[1],
  'A project member may write a note on the project''s publish'
);

set local role postgres;

select is(
  (select analytics_note from public.publishes
    where id = 'd0d0d0d0-0000-4000-8000-000000000003'),
  'Thumbnail swapped on day 3',
  'The note was stored'
);

select is(
  (select analytics_note_updated_by from public.publishes
    where id = 'd0d0d0d0-0000-4000-8000-000000000003'),
  tests.get_supabase_uid('member'),
  'The note records who wrote it'
);

-- ==================================
-- An account member who is not on the project
-- ==================================

select makerkit.authenticate_as('custom');

select results_eq(
  $$ select count(*)::int from public.publishes
      where id = 'd0d0d0d0-0000-4000-8000-000000000003' $$,
  array[1],
  'An account member off the project can read the publish, so the refusal below is not vacuous'
);

select results_eq(
  $$ with updated as (
       update public.publishes set analytics_note = 'overwritten'
        where id = 'd0d0d0d0-0000-4000-8000-000000000003'
        returning 1)
     select count(*)::int from updated $$,
  array[0],
  'An account member who is not on the project cannot write the note'
);

-- ==================================
-- A project viewer
-- ==================================

select makerkit.authenticate_as('viewer');

select results_eq(
  $$ select count(*)::int from public.publishes
      where id = 'd0d0d0d0-0000-4000-8000-000000000003' $$,
  array[1],
  'A project viewer can read the publish'
);

select results_eq(
  $$ with updated as (
       update public.publishes set analytics_note = 'overwritten'
        where id = 'd0d0d0d0-0000-4000-8000-000000000003'
        returning 1)
     select count(*)::int from updated $$,
  array[0],
  'A project viewer cannot write the note'
);

-- ==================================
-- Someone with no access at all
-- ==================================

select makerkit.authenticate_as('outsider');

select results_eq(
  $$ select count(*)::int from public.publishes
      where id = 'd0d0d0d0-0000-4000-8000-000000000003' $$,
  array[0],
  'An outsider cannot see the publish'
);

select results_eq(
  $$ with updated as (
       update public.publishes set analytics_note = 'overwritten'
        where id = 'd0d0d0d0-0000-4000-8000-000000000003'
        returning 1)
     select count(*)::int from updated $$,
  array[0],
  'An outsider cannot write the note'
);

-- ==================================
-- None of the refused writes landed
-- ==================================

set local role postgres;

select is(
  (select analytics_note from public.publishes
    where id = 'd0d0d0d0-0000-4000-8000-000000000003'),
  'Thumbnail swapped on day 3',
  'The note is still the project member''s after three refused writes'
);

-- ==================================
-- Deleting the author does not block, and does not lose the note
-- ==================================

-- Stashed first: the lookup reads auth.users, so evaluating it inside the
-- delete fails once the row it is looking for is gone.
select set_config('note.author', tests.get_supabase_uid('member')::text, true);

delete from auth.users where id = current_setting('note.author')::uuid;

select is(
  (select analytics_note_updated_by from public.publishes
    where id = 'd0d0d0d0-0000-4000-8000-000000000003'),
  null,
  'Deleting the note''s author nulls the author reference'
);

select is(
  (select analytics_note from public.publishes
    where id = 'd0d0d0d0-0000-4000-8000-000000000003'),
  'Thumbnail swapped on day 3',
  'and keeps the note'
);

select * from finish();

rollback;
