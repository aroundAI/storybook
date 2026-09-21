begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(25);

-- FILM-CC-04 KB-1. Seventeen authorship columns referenced auth.users with no
-- ON DELETE action, so `auth.admin.deleteUser` failed with 23503 for any user
-- who had ever created a project, a membership, a fact or a post. The row
-- belongs to the account, not to whoever typed it: deleting the author must
-- succeed and leave every row in place with no author.
--
-- The foreign key alone is not the whole fix, and this file says so in
-- assertions rather than prose:
--   * trigger_set_user_tracking restores created_by on every UPDATE, which
--     undid the key's own SET NULL and failed the delete on the restored id;
--   * kit.prevent_memberships_update raised 'Only the account_role can be
--     updated' at it;
--   * enforce_verified_facts_update_rules raised 'Cannot change created_by'
--     at it, which refused the delete with a different error.
-- (analytics_experiments and content_tags were fixed earlier, in FILM-1610;
-- see analytics-authors-deletable.test.sql.)

select tests.create_supabase_user('author', 'kb1-author@storybook.dev');
select tests.create_supabase_user('colleague', 'kb1-colleague@storybook.dev');

-- The user-tracking triggers take the author from auth.uid(), so the rows on
-- those four tables are written with the author's claims. The role is
-- postgres throughout: this file is about keys and triggers, not policies.
select makerkit.authenticate_as('author');
set local role postgres;

select set_config('kb1.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('kb1.author', tests.get_supabase_uid('author')::text, true);
select set_config('kb1.colleague', tests.get_supabase_uid('colleague')::text, true);

-- accounts.created_by / updated_by: a team the author set up for a colleague
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
  values ('c1c1c1c1-0000-4000-8000-000000000001', 'KB-1 team', false,
          current_setting('kb1.colleague')::uuid);

-- accounts_memberships.created_by / updated_by: the author added a colleague
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (current_setting('kb1.colleague')::uuid, current_setting('kb1.story')::uuid, 'member');

-- projects.created_by / updated_by
insert into public.projects (id, account_id, name, status)
  values ('c1c1c1c1-0000-4000-8000-000000000002', current_setting('kb1.story')::uuid,
          'KB-1 project', 'active'),
         ('c1c1c1c1-0000-4000-8000-000000000003', current_setting('kb1.story')::uuid,
          'KB-1 project a colleague edited', 'active');

-- project_members.created_by / updated_by: the author added a colleague. (The
-- author's own membership, from add_project_owner, goes with the author.)
insert into public.project_members (id, project_id, user_id, role)
  values ('c1c1c1c1-0000-4000-8000-000000000004', 'c1c1c1c1-0000-4000-8000-000000000002',
          current_setting('kb1.colleague')::uuid, 'member');

insert into public.episodes (id, project_id, number, title)
  values ('c1c1c1c1-0000-4000-8000-000000000005', 'c1c1c1c1-0000-4000-8000-000000000002',
          1, 'KB-1 episode');

insert into public.assets (id, project_id, type, name)
  values ('c1c1c1c1-0000-4000-8000-000000000006', 'c1c1c1c1-0000-4000-8000-000000000002',
          'character', 'KB-1 character');

insert into public.verified_facts
    (id, project_id, claim, source_type, verification_status,
     created_by, updated_by, verified_by, verified_at)
  values ('c1c1c1c1-0000-4000-8000-000000000007', 'c1c1c1c1-0000-4000-8000-000000000002',
          'Water boils at 100C at sea level', 'textbook', 'verified',
          current_setting('kb1.author')::uuid, current_setting('kb1.author')::uuid,
          current_setting('kb1.author')::uuid, now());

insert into public.episode_facts (id, episode_id, fact_id, linked_by)
  values ('c1c1c1c1-0000-4000-8000-000000000008', 'c1c1c1c1-0000-4000-8000-000000000005',
          'c1c1c1c1-0000-4000-8000-000000000007', current_setting('kb1.author')::uuid);

insert into public.character_states
    (id, character_id, episode_id, state_type, state_value, trigger_event, created_by)
  values ('c1c1c1c1-0000-4000-8000-000000000009', 'c1c1c1c1-0000-4000-8000-000000000006',
          'c1c1c1c1-0000-4000-8000-000000000005', 'emotional', '{"mood":"grief"}',
          'The funeral', current_setting('kb1.author')::uuid);

insert into public.immutable_events
    (id, project_id, event_type, event_key, established_in, season, episode_number,
     description, created_by)
  values ('c1c1c1c1-0000-4000-8000-00000000000a', 'c1c1c1c1-0000-4000-8000-000000000002',
          'death', 'character:c1c1c1c1-0000-4000-8000-000000000006:dead',
          'c1c1c1c1-0000-4000-8000-000000000005', 1, 1, 'KB-1 character dies',
          current_setting('kb1.author')::uuid);

insert into public.fact_extraction_jobs (id, project_id, source_title, created_by)
  values ('c1c1c1c1-0000-4000-8000-00000000000b', 'c1c1c1c1-0000-4000-8000-000000000002',
          'KB-1 source', current_setting('kb1.author')::uuid);

insert into public.project_intros
    (id, project_id, language, video_url, duration_seconds, created_by)
  values ('c1c1c1c1-0000-4000-8000-00000000000c', 'c1c1c1c1-0000-4000-8000-000000000002',
          'en', 'https://example.com/intro.mp4', 5, current_setting('kb1.author')::uuid);

insert into public.social_posts (id, account_id, raw_notes, created_by)
  values ('c1c1c1c1-0000-4000-8000-00000000000d', current_setting('kb1.story')::uuid,
          'KB-1 notes', current_setting('kb1.author')::uuid);

-- A colleague edits the second project, so its updated_by is theirs.
select makerkit.authenticate_as('colleague');
set local role postgres;

update public.projects set name = 'KB-1 project, edited'
  where id = 'c1c1c1c1-0000-4000-8000-000000000003';

-- Guard against a fixture that never set what the test claims to null: had
-- the inserts above left an author empty, every "is null" below would pass
-- on the unfixed schema too.
select is(
  (select count(*)::int from (
     select created_by from public.accounts where id = 'c1c1c1c1-0000-4000-8000-000000000001'
     union all select updated_by from public.accounts where id = 'c1c1c1c1-0000-4000-8000-000000000001'
     union all select created_by from public.accounts_memberships
       where user_id = current_setting('kb1.colleague')::uuid and account_id = current_setting('kb1.story')::uuid
     union all select updated_by from public.accounts_memberships
       where user_id = current_setting('kb1.colleague')::uuid and account_id = current_setting('kb1.story')::uuid
     union all select created_by from public.projects where id = 'c1c1c1c1-0000-4000-8000-000000000002'
     union all select updated_by from public.projects where id = 'c1c1c1c1-0000-4000-8000-000000000002'
     union all select created_by from public.project_members where id = 'c1c1c1c1-0000-4000-8000-000000000004'
     union all select updated_by from public.project_members where id = 'c1c1c1c1-0000-4000-8000-000000000004'
     union all select created_by from public.verified_facts where id = 'c1c1c1c1-0000-4000-8000-000000000007'
     union all select updated_by from public.verified_facts where id = 'c1c1c1c1-0000-4000-8000-000000000007'
     union all select verified_by from public.verified_facts where id = 'c1c1c1c1-0000-4000-8000-000000000007'
     union all select linked_by from public.episode_facts where id = 'c1c1c1c1-0000-4000-8000-000000000008'
     union all select created_by from public.character_states where id = 'c1c1c1c1-0000-4000-8000-000000000009'
     union all select created_by from public.immutable_events where id = 'c1c1c1c1-0000-4000-8000-00000000000a'
     union all select created_by from public.fact_extraction_jobs where id = 'c1c1c1c1-0000-4000-8000-00000000000b'
     union all select created_by from public.project_intros where id = 'c1c1c1c1-0000-4000-8000-00000000000c'
     union all select created_by from public.social_posts where id = 'c1c1c1c1-0000-4000-8000-00000000000d'
   ) authors(id) where id = current_setting('kb1.author')::uuid),
  17,
  'Fixture: all seventeen authorship columns point at the author'
);

-- GoTrue deletes the user on its own connection, with no JWT claims.
select tests.clear_authentication();
set local role postgres;

select lives_ok(
  $$ delete from auth.users where id = current_setting('kb1.author')::uuid $$,
  'A user who created a project, a membership, a verified fact and a social post can be deleted'
);

-- Each assertion counts the surviving row with a null author, so a row that
-- was cascaded away fails it just as a row that kept its author does.
select is((select count(*)::int from public.accounts
  where id = 'c1c1c1c1-0000-4000-8000-000000000001' and created_by is null),
  1, 'accounts.created_by: the team stays, with no author');
select is((select count(*)::int from public.accounts
  where id = 'c1c1c1c1-0000-4000-8000-000000000001' and updated_by is null),
  1, 'accounts.updated_by: the team stays, with no editor');

select is((select count(*)::int from public.accounts_memberships
  where user_id = current_setting('kb1.colleague')::uuid
    and account_id = current_setting('kb1.story')::uuid and created_by is null),
  1, 'accounts_memberships.created_by: the colleague stays a member, with no author');
select is((select count(*)::int from public.accounts_memberships
  where user_id = current_setting('kb1.colleague')::uuid
    and account_id = current_setting('kb1.story')::uuid and updated_by is null),
  1, 'accounts_memberships.updated_by: the colleague stays a member, with no editor');

select is((select count(*)::int from public.projects
  where id = 'c1c1c1c1-0000-4000-8000-000000000002' and created_by is null),
  1, 'projects.created_by: the project stays, with no author');
select is((select count(*)::int from public.projects
  where id = 'c1c1c1c1-0000-4000-8000-000000000002' and updated_by is null),
  1, 'projects.updated_by: the project stays, with no editor');

select is((select count(*)::int from public.project_members
  where id = 'c1c1c1c1-0000-4000-8000-000000000004' and created_by is null),
  1, 'project_members.created_by: the colleague stays on the project, with no author');
select is((select count(*)::int from public.project_members
  where id = 'c1c1c1c1-0000-4000-8000-000000000004' and updated_by is null),
  1, 'project_members.updated_by: the colleague stays on the project, with no editor');

select is((select count(*)::int from public.verified_facts
  where id = 'c1c1c1c1-0000-4000-8000-000000000007' and created_by is null),
  1, 'verified_facts.created_by: the fact stays, with no author');
select is((select count(*)::int from public.verified_facts
  where id = 'c1c1c1c1-0000-4000-8000-000000000007' and updated_by is null),
  1, 'verified_facts.updated_by: the fact stays, with no editor');
select is((select count(*)::int from public.verified_facts
  where id = 'c1c1c1c1-0000-4000-8000-000000000007' and verified_by is null),
  1, 'verified_facts.verified_by: the fact stays, with no verifier');

select is((select count(*)::int from public.episode_facts
  where id = 'c1c1c1c1-0000-4000-8000-000000000008' and linked_by is null),
  1, 'episode_facts.linked_by: the link stays, with no author');

select is((select count(*)::int from public.character_states
  where id = 'c1c1c1c1-0000-4000-8000-000000000009' and created_by is null),
  1, 'character_states.created_by: the state stays, with no author');

select is((select count(*)::int from public.immutable_events
  where id = 'c1c1c1c1-0000-4000-8000-00000000000a' and created_by is null),
  1, 'immutable_events.created_by: the event stays, with no author');

select is((select count(*)::int from public.fact_extraction_jobs
  where id = 'c1c1c1c1-0000-4000-8000-00000000000b' and created_by is null),
  1, 'fact_extraction_jobs.created_by: the job stays, with no author');

select is((select count(*)::int from public.project_intros
  where id = 'c1c1c1c1-0000-4000-8000-00000000000c' and created_by is null),
  1, 'project_intros.created_by: the intro stays, with no author');

select is((select count(*)::int from public.social_posts
  where id = 'c1c1c1c1-0000-4000-8000-00000000000d' and created_by is null),
  1, 'social_posts.created_by: the post stays, with no author');

-- What nulling one author must not do to the other. The key's SET NULL is an
-- UPDATE, and the tracking trigger stamps updated_by = auth.uid() on every
-- UPDATE — null on GoTrue's connection — which would have erased a living
-- colleague's name from a row they still edit.
select is(
  (select updated_by from public.projects where id = 'c1c1c1c1-0000-4000-8000-000000000003'),
  current_setting('kb1.colleague')::uuid,
  'Deleting a project''s author leaves a colleague''s updated_by alone'
);

-- The verified fact is still verified: losing the verifier's account is not
-- an edit of the claim, so it must not fall back to unverified.
select is(
  (select verification_status::text from public.verified_facts
    where id = 'c1c1c1c1-0000-4000-8000-000000000007'),
  'verified',
  'Deleting the verifier does not un-verify the fact'
);

-- What the fix must not newly permit: the exception is for the key's own
-- action, not for anyone who asks. An ordinary UPDATE still cannot rewrite or
-- clear an author.
select makerkit.authenticate_as('colleague');
set local role postgres;

insert into public.projects (id, account_id, name, status)
  values ('c1c1c1c1-0000-4000-8000-00000000000f', current_setting('kb1.story')::uuid,
          'KB-1 project of the colleague', 'active');

update public.projects set created_by = null
  where id = 'c1c1c1c1-0000-4000-8000-00000000000f';

update public.projects set created_by = current_setting('kb1.colleague')::uuid
  where id = 'c1c1c1c1-0000-4000-8000-000000000002';

select is(
  (select created_by from public.projects where id = 'c1c1c1c1-0000-4000-8000-00000000000f'),
  current_setting('kb1.colleague')::uuid,
  'An ordinary UPDATE still cannot clear a project''s created_by'
);

select isnt(
  (select created_by from public.projects where id = 'c1c1c1c1-0000-4000-8000-000000000002'),
  current_setting('kb1.colleague')::uuid,
  'An ordinary UPDATE still cannot claim a project whose author is gone'
);

insert into public.verified_facts (id, project_id, claim, source_type, created_by)
  values ('c1c1c1c1-0000-4000-8000-00000000000e', 'c1c1c1c1-0000-4000-8000-000000000002',
          'The colleague''s fact', 'other', current_setting('kb1.colleague')::uuid);

select throws_ok(
  $$ update public.verified_facts set created_by = null
      where id = 'c1c1c1c1-0000-4000-8000-00000000000e' $$,
  'Cannot change created_by',
  'An ordinary UPDATE still cannot clear a fact''s created_by'
);

-- And the measurement the bug was found with: nothing in public still blocks
-- a user's deletion through a key with no ON DELETE action.
select is(
  (select count(*)::int from pg_constraint
    where confrelid = 'auth.users'::regclass and confdeltype = 'a'
      and connamespace = 'public'::regnamespace),
  0,
  'No foreign key from public to auth.users is left with no ON DELETE action'
);

select * from finish();

rollback;
