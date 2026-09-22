begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(21);

-- FILM-CC-04 KB-1, owner decision 2026-09-22. Deleting a user nulls every
-- authorship key (authors-deletable.test.sql). Two of those columns are audit
-- records — who established a canon event, who verified a fact — and for
-- those the owner wants the name kept once the key is gone:
-- immutable_events.created_by_name and verified_facts.verified_by_name.
--
-- The name is the author's display name (their personal account's
-- `accounts.name`), taken when the author is written, never at delete time,
-- and never from the client.

select tests.create_supabase_user('verifier', 'kb1-verifier@storybook.dev');
select tests.create_supabase_user('forger', 'kb1-forger@storybook.dev');
select tests.create_supabase_user('stranger', 'kb1-stranger@storybook.dev');

select makerkit.authenticate_as('verifier');
set local role postgres;

select set_config('snap.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('snap.verifier', tests.get_supabase_uid('verifier')::text, true);
select set_config('snap.forger', tests.get_supabase_uid('forger')::text, true);

update public.accounts set name = 'Vera Verifier' where id = current_setting('snap.verifier')::uuid;
update public.accounts set name = 'Fred Forger' where id = current_setting('snap.forger')::uuid;
update public.accounts set name = 'Sam Stranger' where id = tests.get_supabase_uid('stranger');

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (current_setting('snap.forger')::uuid, current_setting('snap.story')::uuid, 'member');

insert into public.projects (id, account_id, name, status)
  values ('d1d1d1d1-0000-4000-8000-000000000001', current_setting('snap.story')::uuid,
          'Snapshot project', 'active');

insert into public.project_members (project_id, user_id, role)
  values ('d1d1d1d1-0000-4000-8000-000000000001', current_setting('snap.forger')::uuid, 'member');

insert into public.episodes (id, project_id, number, title)
  values ('d1d1d1d1-0000-4000-8000-000000000002', 'd1d1d1d1-0000-4000-8000-000000000001',
          1, 'Snapshot episode');

-- First, before anything else has touched the table: a member writes an event
-- in the name of a user whose account they cannot read. The policy lets a
-- member name any created_by (as it did before this column existed); the name
-- still belongs to that id. That is why the trigger is SECURITY DEFINER — what
-- a record says must not depend on who wrote it.
--
-- It has to come first to be able to fail. Postgres keeps an SQL function's
-- plan for the life of its call site, which here is the transaction: had a
-- privileged insert run before this one, the lookup would go on reading
-- accounts without row security and an invoker trigger would pass too.
select makerkit.authenticate_as('forger');

insert into public.immutable_events
    (id, project_id, event_type, event_key, established_in, season, episode_number,
     description, created_by, created_by_name)
  values ('d1d1d1d1-0000-4000-8000-00000000000a', 'd1d1d1d1-0000-4000-8000-000000000001',
          'death', 'character:stranger:dead', 'd1d1d1d1-0000-4000-8000-000000000002',
          1, 1, 'Event in a stranger''s name', tests.get_supabase_uid('stranger'), 'Fred Forger');

update public.verified_facts set verified_by_name = 'Vera Verifier'
  where id = 'd1d1d1d1-0000-4000-8000-000000000007';

select makerkit.authenticate_as('verifier');
set local role postgres;

-- The verifier's own rows, written the way the product writes them: the event
-- on insert, the verification as a later UPDATE by a privileged caller (the
-- update policy refuses `verified_by` to members). Both arrive with a forged
-- name, which must lose to the id.
insert into public.immutable_events
    (id, project_id, event_type, event_key, established_in, season, episode_number,
     description, created_by, created_by_name)
  values ('d1d1d1d1-0000-4000-8000-000000000003', 'd1d1d1d1-0000-4000-8000-000000000001',
          'death', 'character:snapshot:dead', 'd1d1d1d1-0000-4000-8000-000000000002',
          1, 1, 'Snapshot character dies', current_setting('snap.verifier')::uuid,
          'Somebody Else');

insert into public.verified_facts (id, project_id, claim, source_type)
  values ('d1d1d1d1-0000-4000-8000-000000000004', 'd1d1d1d1-0000-4000-8000-000000000001',
          'Water boils at 100C at sea level', 'textbook'),
         ('d1d1d1d1-0000-4000-8000-000000000005', 'd1d1d1d1-0000-4000-8000-000000000001',
          'Ice melts at 0C', 'textbook'),
         ('d1d1d1d1-0000-4000-8000-000000000009', 'd1d1d1d1-0000-4000-8000-000000000001',
          'Light is fast', 'textbook');

update public.verified_facts
   set verification_status = 'verified', verified_at = now(),
       verified_by = current_setting('snap.verifier')::uuid,
       verified_by_name = 'Somebody Else'
 where id in ('d1d1d1d1-0000-4000-8000-000000000004', 'd1d1d1d1-0000-4000-8000-000000000005',
              'd1d1d1d1-0000-4000-8000-000000000009');

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  'Vera Verifier',
  'immutable_events: the name comes from created_by, not from the insert'
);

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'Vera Verifier',
  'verified_facts: the name comes from verified_by, not from the update'
);

-- A member, through the policies, with a forged name.
select makerkit.authenticate_as('forger');

insert into public.immutable_events
    (id, project_id, event_type, event_key, established_in, season, episode_number,
     description, created_by, created_by_name)
  values ('d1d1d1d1-0000-4000-8000-000000000006', 'd1d1d1d1-0000-4000-8000-000000000001',
          'death', 'character:forged:dead', 'd1d1d1d1-0000-4000-8000-000000000002',
          1, 1, 'Forged event', tests.get_supabase_uid('forger'), 'Vera Verifier');

insert into public.verified_facts (id, project_id, claim, source_type, verified_by_name)
  values ('d1d1d1d1-0000-4000-8000-000000000007', 'd1d1d1d1-0000-4000-8000-000000000001',
          'A forged fact', 'other', 'Vera Verifier');

update public.immutable_events set created_by_name = 'Vera Verifier'
  where id = 'd1d1d1d1-0000-4000-8000-000000000006';

set local role postgres;

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-000000000006'),
  'Fred Forger',
  'A member inserting an event under a forged name gets their own, and an UPDATE cannot change it'
);

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-00000000000a'),
  'Sam Stranger',
  'The name is the id''s, even when the writer cannot read that user''s account'
);

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000007'),
  null,
  'A member cannot name a verifier on a fact nobody verified, on insert or by UPDATE'
);

-- Even a privileged UPDATE cannot rewrite the name while the verifier stands.
update public.verified_facts set verified_by_name = 'Somebody Else', verification_notes = 'checked'
  where id = 'd1d1d1d1-0000-4000-8000-000000000004';

update public.immutable_events set created_by_name = 'Somebody Else', description = 'Edited'
  where id = 'd1d1d1d1-0000-4000-8000-000000000003';

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'Vera Verifier',
  'verified_facts: an ordinary UPDATE cannot change the name'
);

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  'Vera Verifier',
  'immutable_events: an ordinary UPDATE cannot change the name'
);

-- Taken when written: the record says who they were then.
update public.accounts set name = 'Vera Renamed' where id = current_setting('snap.verifier')::uuid;

update public.verified_facts set verification_notes = 'checked twice'
  where id = 'd1d1d1d1-0000-4000-8000-000000000004';

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'Vera Verifier',
  'A later rename does not rewrite the record, nor does the next UPDATE of the row'
);

-- The name lasts as long as the verification does. Editing the claim ends it
-- (enforce_verified_facts_update_rules clears verified_by and verified_at), and
-- the name goes too — which also pins the trigger order: the name trigger has
-- to fire after that one to see what it decided.
update public.verified_facts set claim = 'Ice melts at 0C at one atmosphere'
  where id = 'd1d1d1d1-0000-4000-8000-000000000005';

select is(
  (select verification_status::text || '/' || coalesce(verified_by_name, 'no name')
     from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000005'),
  'unverified/no name',
  'Editing the claim un-verifies the fact and drops the verifier''s name with it'
);

-- The author is deleted. GoTrue does it on its own connection, with no claims.
select tests.clear_authentication();
set local role postgres;

select lives_ok(
  $$ delete from auth.users where id = current_setting('snap.verifier')::uuid $$,
  'The author of an event and verifier of a fact can be deleted'
);

select is(
  (select count(*)::int from public.immutable_events
    where id = 'd1d1d1d1-0000-4000-8000-000000000003' and created_by is null),
  1, 'immutable_events: the event stays, its key cleared');

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  'Vera Verifier',
  'immutable_events: and it still says who established it'
);

select is(
  (select count(*)::int from public.verified_facts
    where id = 'd1d1d1d1-0000-4000-8000-000000000004' and verified_by is null),
  1, 'verified_facts: the fact stays, its key cleared');

select is(
  (select verification_status::text from public.verified_facts
    where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'verified',
  'verified_facts: a deleted verifier does not un-verify the fact'
);

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'Vera Verifier',
  'verified_facts: and the fact still says who verified it'
);

-- With the key gone the name is all that is left, so it is frozen: not
-- rewritten, not cleared, not by a member and not by a privileged caller.
update public.verified_facts set verified_by_name = 'Somebody Else'
  where id = 'd1d1d1d1-0000-4000-8000-000000000004';
update public.immutable_events set created_by_name = null
  where id = 'd1d1d1d1-0000-4000-8000-000000000003';

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'Vera Verifier',
  'verified_facts: the orphaned name cannot be rewritten'
);

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-000000000003'),
  'Vera Verifier',
  'immutable_events: the orphaned name cannot be cleared'
);

-- ...but it still ends with the verification, author or no author.
update public.verified_facts set claim = 'Light is very fast'
  where id = 'd1d1d1d1-0000-4000-8000-000000000009';

select is(
  (select verification_status::text || '/' || coalesce(verified_by_name, 'no name')
     from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000009'),
  'unverified/no name',
  'Editing the claim of a fact whose verifier is gone drops the orphaned name too'
);

-- The existing rules on the fact are untouched by any of this.
select throws_ok(
  $$ update public.verified_facts set project_id = gen_random_uuid()
      where id = 'd1d1d1d1-0000-4000-8000-000000000004' $$,
  'Cannot move a fact to a different project',
  'verified_facts: the update rules still refuse an ordinary edit they refused before'
);

-- Re-verification by someone else replaces the orphaned name.
update public.verified_facts
   set verified_by = current_setting('snap.forger')::uuid, verified_at = now()
 where id = 'd1d1d1d1-0000-4000-8000-000000000004';

select is(
  (select verified_by_name from public.verified_facts where id = 'd1d1d1d1-0000-4000-8000-000000000004'),
  'Fred Forger',
  'A new verifier brings their own name'
);

-- An author with no personal account name leaves no name, rather than ''.
update public.accounts set name = '' where id = current_setting('snap.forger')::uuid;

insert into public.immutable_events
    (id, project_id, event_type, event_key, established_in, season, episode_number,
     description, created_by)
  values ('d1d1d1d1-0000-4000-8000-000000000008', 'd1d1d1d1-0000-4000-8000-000000000001',
          'death', 'character:nameless:dead', 'd1d1d1d1-0000-4000-8000-000000000002',
          1, 1, 'Nameless event', current_setting('snap.forger')::uuid);

select is(
  (select created_by_name from public.immutable_events where id = 'd1d1d1d1-0000-4000-8000-000000000008'),
  null,
  'An empty display name is stored as no name'
);

select * from finish();

rollback;
