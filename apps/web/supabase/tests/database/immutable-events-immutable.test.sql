begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-17. A fixed plan, so a run that aborts early fails as a plan mismatch
-- instead of reading as a nearly-passing suite.
select plan(39);

-- KB-99: the product is team accounts only; someone working alone is a team
-- of one. A fixture that used to sit on a user's personal account sits on a
-- team that user owns instead, with the owner membership a team always has.
create function pg_temp.solo_team(identifier text) returns uuid
language plpgsql security definer as $$
declare
  team uuid := md5('kb99-solo:' || identifier)::uuid;
begin
  insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
  values (team, identifier || ' (team of one)', false, tests.get_supabase_uid(identifier))
  on conflict (id) do nothing;

  insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid(identifier), team, 'owner')
  on conflict do nothing;

  return team;
end;
$$;
grant execute on function pg_temp.solo_team(text) to authenticated;

-- An immutable event is canon the continuity validator treats as fixed.
-- Before KB-17 one FOR ALL policy on has_role_on_account, with no WITH
-- CHECK, let any account member (project viewers and members not on the
-- project included) rewrite, delete or re-author one, and insert one in a
-- colleague's name; personal-account owners could not read their own.
--
-- The rules (owner's decisions, 2026-09-23):
--   read    has_account_access on the project's account
--   insert  can_write_project, as yourself, established in an episode of
--           the same project
--   delete  can_write_project (D1)
--   update  nobody, by any role (D3) -- except the auth.users foreign key
--           clearing a deleted author, which KB-1 relies on
--
-- Fixtures:
--   T   team account of kb17_owner; kb17_member, kb17_viewer and
--       kb17_teammate have account roles. P is T's project: kb17_owner's
--       owner row comes from the creator trigger, kb17_member is a project
--       member, kb17_viewer a project viewer, kb17_teammate has no project
--       row. E is P's episode.
--   S   kb17_solo's project on their team of one, episode F.
--   X   kb17_stranger's project on their team of one, episode EX.
--   kb17_author wrote the event that I6 deletes them from.
--
-- Every case works on its own event key, so a case cannot pass or fail
-- because of what an earlier one did.

select tests.create_supabase_user('kb17_owner', 'kb17-owner@storybook.dev');
select tests.create_supabase_user('kb17_member', 'kb17-member@storybook.dev');
select tests.create_supabase_user('kb17_viewer', 'kb17-viewer@storybook.dev');
select tests.create_supabase_user('kb17_teammate', 'kb17-teammate@storybook.dev');
select tests.create_supabase_user('kb17_solo', 'kb17-solo@storybook.dev');
select tests.create_supabase_user('kb17_stranger', 'kb17-stranger@storybook.dev');
select tests.create_supabase_user('kb17_author', 'kb17-author@storybook.dev');

select makerkit.authenticate_as('kb17_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('17170000-0000-4000-8000-00000000000a', 'KB-17 team', false, tests.get_supabase_uid('kb17_owner'));

insert into public.projects (id, account_id, name, status)
values ('17170000-0000-4000-8000-000000000001', '17170000-0000-4000-8000-00000000000a', 'KB-17 P', 'active');

select makerkit.authenticate_as('kb17_solo');
set local role postgres;

insert into public.projects (id, account_id, name, status)
values ('17170000-0000-4000-8000-000000000005', pg_temp.solo_team('kb17_solo'), 'KB-17 S', 'active');

select makerkit.authenticate_as('kb17_stranger');
set local role postgres;

insert into public.projects (id, account_id, name, status)
values ('17170000-0000-4000-8000-000000000007', pg_temp.solo_team('kb17_stranger'), 'KB-17 X', 'active');

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('kb17_member'), '17170000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb17_viewer'), '17170000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb17_teammate'), '17170000-0000-4000-8000-00000000000a', 'member');

insert into public.project_members (project_id, user_id, role)
values
  ('17170000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb17_member'), 'member'),
  ('17170000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb17_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title)
values
  ('17170000-0000-4000-8000-000000000002', '17170000-0000-4000-8000-000000000001', 1, 'E'),
  ('17170000-0000-4000-8000-000000000006', '17170000-0000-4000-8000-000000000005', 1, 'F'),
  ('17170000-0000-4000-8000-000000000008', '17170000-0000-4000-8000-000000000007', 1, 'EX');

update public.accounts set name = 'Mia Member' where id = tests.get_supabase_uid('kb17_member');
update public.accounts set name = 'Ada Author' where id = tests.get_supabase_uid('kb17_author');

-- Events in P written by the owner (or, for I6, by kb17_author), and one in S.
insert into public.immutable_events
  (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
select '17170000-0000-4000-8000-000000000001', 'death', k, '17170000-0000-4000-8000-000000000002',
       1, 1, 'Original ' || k,
       tests.get_supabase_uid(case when k = 'i6:authored' then 'kb17_author' else 'kb17_owner' end)
  from unnest(array['i1:seen', 'i3:member', 'i3:owner', 'i3:author', 'i4:postgres', 'i4:service',
                    'i4:author', 'i4:clear', 'i5:nested', 'i5:nested-clear', 'i6:authored',
                    'i7:member', 'i7:owner', 'i7:viewer', 'i7:teammate', 'i7:stranger']) k;

insert into public.immutable_events
  (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
values
  ('17170000-0000-4000-8000-000000000005', 'death', 'i1:solo', '17170000-0000-4000-8000-000000000006',
   1, 1, 'Solo canon', tests.get_supabase_uid('kb17_solo')),
  ('17170000-0000-4000-8000-000000000005', 'death', 'i7:solo', '17170000-0000-4000-8000-000000000006',
   1, 1, 'Solo canon to delete', tests.get_supabase_uid('kb17_solo'));

-- Counts and reads as postgres, whoever the case ran as.
create or replace function pg_temp.events(p_key text) returns bigint language sql as $$
  select count(*) from public.immutable_events where event_key = p_key;
$$;

create or replace function pg_temp.row_of(p_key text) returns text language sql as $$
  select description || ' / ' || coalesce(created_by::text, 'no author') || ' / '
         || coalesce(created_by_name, 'no name')
    from public.immutable_events where event_key = p_key;
$$;

select set_config('kb17.i3', pg_temp.row_of('i3:member'), true);

-- ==================================
-- I1: who reads (each count runs under the caller's own row-level security)
-- ==================================
select makerkit.authenticate_as('kb17_owner');
select is((select count(*) from public.immutable_events where event_key = 'i1:seen'), 1::bigint, 'I1: the project owner reads the project''s canon');

select makerkit.authenticate_as('kb17_member');
select is((select count(*) from public.immutable_events where event_key = 'i1:seen'), 1::bigint, 'I1: a project member reads it');

select makerkit.authenticate_as('kb17_viewer');
select is((select count(*) from public.immutable_events where event_key = 'i1:seen'), 1::bigint, 'I1: a project viewer reads it');

select makerkit.authenticate_as('kb17_teammate');
select is((select count(*) from public.immutable_events where event_key = 'i1:seen'), 1::bigint, 'I1: a team member with no project row reads it (reads are on account membership)');

select makerkit.authenticate_as('kb17_stranger');
select is((select count(*) from public.immutable_events where event_key = 'i1:seen'), 0::bigint, 'I1: someone outside the account reads nothing');

select makerkit.authenticate_as('kb17_solo');
select is((select count(*) from public.immutable_events where event_key = 'i1:solo'), 1::bigint, 'I1: a team-of-one owner reads their own project''s canon');

-- ==================================
-- I2: who inserts, as whom, where
-- ==================================
select makerkit.authenticate_as('kb17_member');

select lives_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000001', 'death', 'i2:member', '17170000-0000-4000-8000-000000000002',
             1, 1, 'A member''s canon', auth.uid()) $$,
  'I2: a project member adds an event as themselves'
);

set local role postgres;
select is(
  (select created_by_name from public.immutable_events where event_key = 'i2:member'),
  'Mia Member',
  'I2: and it carries their name'
);

select makerkit.authenticate_as('kb17_member');
select throws_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000001', 'death', 'i2:forged', '17170000-0000-4000-8000-000000000002',
             1, 1, 'Forged canon', tests.get_supabase_uid('kb17_owner')) $$,
  '42501', null,
  'I2: a member cannot add an event in the owner''s name'
);

select makerkit.authenticate_as('kb17_viewer');
select throws_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000001', 'death', 'i2:viewer', '17170000-0000-4000-8000-000000000002',
             1, 1, 'Viewer canon', auth.uid()) $$,
  '42501', null,
  'I2: a project viewer cannot add canon'
);

select makerkit.authenticate_as('kb17_teammate');
select throws_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000001', 'death', 'i2:teammate', '17170000-0000-4000-8000-000000000002',
             1, 1, 'Teammate canon', auth.uid()) $$,
  '42501', null,
  'I2: a team member with no project row cannot add canon'
);

select makerkit.authenticate_as('kb17_stranger');
select throws_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000001', 'death', 'i2:stranger', '17170000-0000-4000-8000-000000000002',
             1, 1, 'Stranger canon', auth.uid()) $$,
  '42501', null,
  'I2: someone outside the account cannot add canon'
);

select makerkit.authenticate_as('kb17_solo');
select lives_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000005', 'death', 'i2:solo', '17170000-0000-4000-8000-000000000006',
             1, 1, 'Solo canon, added', auth.uid()) $$,
  'I2: a team-of-one owner adds canon to their own project'
);

select makerkit.authenticate_as('kb17_member');
select throws_ok(
  $$ insert into public.immutable_events
       (project_id, event_type, event_key, established_in, season, episode_number, description, created_by)
     values ('17170000-0000-4000-8000-000000000001', 'death', 'i2:foreign', '17170000-0000-4000-8000-000000000008',
             1, 1, 'Established in someone else''s episode', auth.uid()) $$,
  '42501', null,
  'I2: an event cannot claim to be established in another project''s episode'
);

-- ==================================
-- I3: end users cannot change an event
-- ==================================
select makerkit.authenticate_as('kb17_member');
select throws_ok(
  $$ update public.immutable_events set description = 'REWRITTEN' where event_key = 'i3:member' $$,
  '42501', 'permission denied for table immutable_events',
  'I3: a member cannot rewrite an event'
);

select makerkit.authenticate_as('kb17_owner');
select throws_ok(
  $$ update public.immutable_events set description = 'REWRITTEN' where event_key = 'i3:owner' $$,
  '42501', 'permission denied for table immutable_events',
  'I3: nor can the project owner'
);

select makerkit.authenticate_as('kb17_member');
select throws_ok(
  $$ update public.immutable_events set created_by = auth.uid() where event_key = 'i3:author' $$,
  '42501', 'permission denied for table immutable_events',
  'I3: a member cannot put their name on an event'
);

set local role postgres;
select is(pg_temp.row_of('i3:member'), current_setting('kb17.i3'), 'I3: the event is exactly as written');

-- ==================================
-- I4: nor can any privileged role
-- ==================================
set local role postgres;
select throws_ok(
  $$ update public.immutable_events set description = 'REWRITTEN' where event_key = 'i4:postgres' $$,
  '42501', 'immutable_events rows cannot be changed',
  'I4: the table owner cannot rewrite an event'
);

set local role service_role;
select throws_ok(
  $$ update public.immutable_events set description = 'REWRITTEN' where event_key = 'i4:service' $$,
  '42501', 'immutable_events rows cannot be changed',
  'I4: the service role cannot rewrite an event'
);

set local role postgres;
select throws_ok(
  $$ update public.immutable_events set created_by = tests.get_supabase_uid('kb17_member') where event_key = 'i4:author' $$,
  '42501', 'immutable_events rows cannot be changed',
  'I4: a privileged role cannot re-author an event'
);

select throws_ok(
  $$ update public.immutable_events set created_by = null where event_key = 'i4:clear' $$,
  '42501', 'immutable_events rows cannot be changed',
  'I4: clearing the author by hand is not a user deletion, and is refused'
);

select is(pg_temp.row_of('i4:postgres'), 'Original i4:postgres / ' || tests.get_supabase_uid('kb17_owner')::text || ' / ' || (select name from public.accounts where id = tests.get_supabase_uid('kb17_owner')),
  'I4: the event is exactly as written');

-- ==================================
-- I5: the user-deletion exception is exactly that
-- ==================================
-- An update arriving from inside another trigger (depth 2, like a foreign
-- key's action) that changes anything besides clearing the author.
set local role postgres;
create temp table kb17_poke (event_key text, clear boolean);

create or replace function pg_temp.kb17_poke() returns trigger language plpgsql as $$
begin
  update public.immutable_events
     set description = 'Nested rewrite',
         created_by = case when new.clear then null else created_by end
   where event_key = new.event_key;
  return new;
end;
$$;

create trigger kb17_poke after insert on kb17_poke
  for each row execute function pg_temp.kb17_poke();

select throws_ok(
  $$ insert into kb17_poke values ('i5:nested', false) $$,
  '42501', 'immutable_events rows cannot be changed',
  'I5: a nested update that rewrites an event is refused'
);

select throws_ok(
  $$ insert into kb17_poke values ('i5:nested-clear', true) $$,
  '42501', 'immutable_events rows cannot be changed',
  'I5: a nested update that clears the author AND rewrites is refused'
);

-- ==================================
-- I6: deleting an author still works (KB-1)
-- ==================================
select tests.clear_authentication();
set local role postgres;

-- The id is looked up once, before the delete. tests.get_supabase_uid is
-- VOLATILE, so in the DELETE's WHERE it would run for every row scanned and
-- see the statement's own deletion: once the author's row was gone, the next
-- lookup raised "User with identifier kb17_author not found". Whether a row
-- came after it depended on the heap order of auth.users, which is why this
-- failed only sometimes, and only after other suites had run.
select set_config('kb17.author', tests.get_supabase_uid('kb17_author')::text, true);

select lives_ok(
  $$ delete from auth.users where id = current_setting('kb17.author')::uuid $$,
  'I6: the author of an event can be deleted'
);

select is(pg_temp.row_of('i6:authored'), 'Original i6:authored / no author / Ada Author',
  'I6: the event stays, unchanged, its author key cleared and their name kept');

-- ==================================
-- I7: who deletes (D1: project writers)
-- ==================================
select makerkit.authenticate_as('kb17_member');
delete from public.immutable_events where event_key = 'i7:member';
set local role postgres;
select is(pg_temp.events('i7:member'), 0::bigint, 'I7: a project member deletes an event');

select makerkit.authenticate_as('kb17_owner');
delete from public.immutable_events where event_key = 'i7:owner';
set local role postgres;
select is(pg_temp.events('i7:owner'), 0::bigint, 'I7: the project owner deletes an event');

select makerkit.authenticate_as('kb17_viewer');
delete from public.immutable_events where event_key = 'i7:viewer';
set local role postgres;
select is(pg_temp.events('i7:viewer'), 1::bigint, 'I7: a project viewer cannot delete canon');

select makerkit.authenticate_as('kb17_teammate');
delete from public.immutable_events where event_key = 'i7:teammate';
set local role postgres;
select is(pg_temp.events('i7:teammate'), 1::bigint, 'I7: a team member with no project row cannot delete canon');

select makerkit.authenticate_as('kb17_stranger');
delete from public.immutable_events where event_key = 'i7:stranger';
set local role postgres;
select is(pg_temp.events('i7:stranger'), 1::bigint, 'I7: someone outside the account cannot delete canon');

select makerkit.authenticate_as('kb17_solo');
delete from public.immutable_events where event_key = 'i7:solo';
set local role postgres;
select is(pg_temp.events('i7:solo'), 0::bigint, 'I7: a team-of-one owner deletes their own canon');

-- ==================================
-- I8: the RPC writes events the same way (KB-27 §19 i)
-- ==================================
-- commit_canon_changes is SECURITY DEFINER, so the policies above do not
-- apply inside it; it must author events as its caller by itself.
select makerkit.authenticate_as('kb17_member');
select lives_ok(
  $$ select public.commit_canon_changes('17170000-0000-4000-8000-000000000001', '17170000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"death","eventKey":"i8:rpc","description":"Committed canon"}]', 'Summary', 0.5) $$,
  'I8: a member commits canon through the RPC'
);

set local role postgres;
select is(
  (select created_by::text || ' / ' || created_by_name from public.immutable_events where event_key = 'i8:rpc'),
  tests.get_supabase_uid('kb17_member')::text || ' / Mia Member',
  'I8: the RPC''s event is authored by its caller, under their name'
);

-- ==================================
-- I9: the shape, so a later migration cannot quietly widen it
-- ==================================
select policies_are('public', 'immutable_events',
  array['immutable_events_read', 'immutable_events_insert', 'immutable_events_delete'],
  'I9: one policy per verb, and none for UPDATE');

select table_privs_are('public', 'immutable_events', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'I9: authenticated may select, insert and delete, never update');

select table_privs_are('public', 'immutable_events', 'anon', array[]::text[],
  'I9: anon has no privilege on canon');

select trigger_is('public', 'immutable_events', 'immutable_events_refuse_update',
  'public', 'immutable_events_refuse_update',
  'I9: the write-once trigger is in place');

select * from finish();

rollback;
