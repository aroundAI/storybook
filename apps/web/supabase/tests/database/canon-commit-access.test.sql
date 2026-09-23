begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-27. A fixed plan, so a run that aborts early fails as a plan mismatch
-- instead of reading as a nearly-passing suite.
select plan(27);

-- commit_canon_changes is SECURITY DEFINER, so row-level security does not
-- apply inside it: every access rule has to be in the function. Before
-- KB-27 there was none, and any signed-in user could add permanent canon to,
-- and overwrite the canon summary of, any project's episode.
--
-- The rule (owner's decision, 2026-09-23) is public.can_write_project: an
-- owner, admin or member in project_members. A role on the account is not
-- enough, and neither is a viewer row.
--
-- Fixtures:
--   T   team account of kb27_owner. kb27_teammate and kb27_viewer have
--       account roles. P is T's project (kb27_owner's owner row comes from
--       the creator trigger); kb27_viewer is a project viewer; kb27_teammate
--       has no project row until T4b. E is P's episode.
--   U   team account of kb27_rival, with project PU and episode EU.
--   S   kb27_solo's project on their personal account, episode F. The
--       creator's owner row is the only way a personal-account owner can
--       write: personal accounts have no membership row.
--   kb27_stranger has only a personal account.
--
-- Every case uses its own event key and resets E's metadata first, so a
-- case cannot pass or fail because of what an earlier one wrote.

select tests.create_supabase_user('kb27_owner', 'kb27-owner@storybook.dev');
select tests.create_supabase_user('kb27_teammate', 'kb27-teammate@storybook.dev');
select tests.create_supabase_user('kb27_viewer', 'kb27-viewer@storybook.dev');
select tests.create_supabase_user('kb27_rival', 'kb27-rival@storybook.dev');
select tests.create_supabase_user('kb27_solo', 'kb27-solo@storybook.dev');
select tests.create_supabase_user('kb27_stranger', 'kb27-stranger@storybook.dev');

-- Accounts and projects are written with their owner's claims, so the
-- membership and creator triggers see the right auth.uid().
select makerkit.authenticate_as('kb27_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('27270000-0000-4000-8000-00000000000a', 'KB-27 team', false, tests.get_supabase_uid('kb27_owner'));

insert into public.projects (id, account_id, name, status)
values ('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-00000000000a', 'KB-27 P', 'active');

select makerkit.authenticate_as('kb27_rival');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('27270000-0000-4000-8000-00000000000b', 'KB-27 rival team', false, tests.get_supabase_uid('kb27_rival'));

insert into public.projects (id, account_id, name, status)
values ('27270000-0000-4000-8000-000000000003', '27270000-0000-4000-8000-00000000000b', 'KB-27 PU', 'active');

select makerkit.authenticate_as('kb27_solo');
set local role postgres;

insert into public.projects (id, account_id, name, status)
values ('27270000-0000-4000-8000-000000000005', tests.get_supabase_uid('kb27_solo'), 'KB-27 S', 'active');

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('kb27_teammate'), '27270000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb27_viewer'), '27270000-0000-4000-8000-00000000000a', 'member');

insert into public.project_members (project_id, user_id, role)
values ('27270000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb27_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title)
values
  ('27270000-0000-4000-8000-000000000002', '27270000-0000-4000-8000-000000000001', 1, 'E'),
  ('27270000-0000-4000-8000-000000000004', '27270000-0000-4000-8000-000000000003', 1, 'EU'),
  ('27270000-0000-4000-8000-000000000006', '27270000-0000-4000-8000-000000000005', 1, 'F');

update public.accounts set name = 'Tess Teammate' where id = tests.get_supabase_uid('kb27_teammate');

create or replace function pg_temp.reset_e() returns void language sql as $$
  update public.episodes
     set metadata = '{"canonSummary": "The real summary", "keep": "me"}'
   where id = '27270000-0000-4000-8000-000000000002';
$$;

create or replace function pg_temp.e_summary() returns text language sql as $$
  select metadata->>'canonSummary' from public.episodes
   where id = '27270000-0000-4000-8000-000000000002';
$$;

create or replace function pg_temp.events(p_key text) returns bigint language sql as $$
  select count(*) from public.immutable_events where event_key = p_key;
$$;

-- ==================================
-- T1: a stranger
-- ==================================
select pg_temp.reset_e();
select makerkit.authenticate_as('kb27_stranger');

select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"death","eventKey":"t1:forged","description":"FORGED"}]', 'FORGED by a stranger', 0.10) $$,
  '42501', 'No access to this project''s canon',
  'T1: a stranger is refused'
);

set local role postgres;
select is(pg_temp.events('t1:forged'), 0::bigint, 'T1: the stranger wrote no event');
select is(pg_temp.e_summary(), 'The real summary', 'T1: the episode summary is unchanged');

-- ==================================
-- T2: an owner of another team
-- ==================================
select pg_temp.reset_e();
select makerkit.authenticate_as('kb27_rival');

select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"death","eventKey":"t2:forged","description":"FORGED"}]', 'FORGED by a rival', 0.10) $$,
  '42501', 'No access to this project''s canon',
  'T2: another team''s owner is refused'
);

set local role postgres;
select is(pg_temp.events('t2:forged'), 0::bigint, 'T2: the rival wrote no event');
select is(pg_temp.e_summary(), 'The real summary', 'T2: the episode summary is unchanged');

-- ==================================
-- T3: a project the caller does write, with an episode that is not in it
-- ==================================
select pg_temp.reset_e();
select makerkit.authenticate_as('kb27_rival');

select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000003', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"world_fact","eventKey":"t3:crosslinked","description":"cross-linked"}]', 'FORGED via mismatched ids', 0.20) $$,
  '42501', 'No access to this project''s canon',
  'T3: an episode from another project is refused, even in a project the caller writes'
);

set local role postgres;
select is(pg_temp.events('t3:crosslinked'), 0::bigint, 'T3: no event in either project');
select is(pg_temp.e_summary(), 'The real summary', 'T3: the other project''s episode summary is unchanged');

-- ==================================
-- T4a: a team member with no project row (owner's decision: refused)
-- ==================================
select pg_temp.reset_e();
select makerkit.authenticate_as('kb27_teammate');

select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"timeline","eventKey":"t4a:teammate","description":"no project row"}]', 'Teammate summary', 0.50) $$,
  '42501', 'No access to this project''s canon',
  'T4a: a role on the account without a project row is refused'
);

set local role postgres;
select is(pg_temp.events('t4a:teammate'), 0::bigint, 'T4a: no event written');
select is(pg_temp.e_summary(), 'The real summary', 'T4a: the episode summary is unchanged');

-- ==================================
-- T4c: a project viewer
-- ==================================
select pg_temp.reset_e();
select makerkit.authenticate_as('kb27_viewer');

select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"timeline","eventKey":"t4c:viewer","description":"viewer"}]', 'Viewer summary', 0.50) $$,
  '42501', 'No access to this project''s canon',
  'T4c: a project viewer is refused'
);

set local role postgres;
select is(pg_temp.events('t4c:viewer'), 0::bigint, 'T4c: no event written');
select is(pg_temp.e_summary(), 'The real summary', 'T4c: the episode summary is unchanged');

-- ==================================
-- T4b: the same teammate, once added as a project member
-- ==================================
select pg_temp.reset_e();
insert into public.project_members (project_id, user_id, role)
values ('27270000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb27_teammate'), 'member');

select makerkit.authenticate_as('kb27_teammate');

select lives_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"timeline","eventKey":"t4b:member","description":"now a member"}]', 'Member summary', 0.50) $$,
  'T4b: a project member commits'
);

set local role postgres;
select is(
  (select created_by from public.immutable_events where event_key = 't4b:member'),
  tests.get_supabase_uid('kb27_teammate'),
  'T4b: the event names the caller as its author'
);
select is(
  (select created_by_name from public.immutable_events where event_key = 't4b:member'),
  'Tess Teammate',
  'T4b: the author name snapshot follows (KB-1)'
);
select is(
  (select metadata from public.episodes where id = '27270000-0000-4000-8000-000000000002'),
  '{"canonSummary": "Member summary", "sentimentScore": 0.50, "keep": "me"}'::jsonb,
  'T4b: the summary is merged and every other metadata key kept'
);

-- ==================================
-- T5: a personal-account owner, on their own project
-- ==================================
select is(
  (select count(*) from public.accounts_memberships where account_id = tests.get_supabase_uid('kb27_solo')),
  0::bigint,
  'T5 precondition: the personal account has no membership row'
);

select makerkit.authenticate_as('kb27_solo');

select lives_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000005', '27270000-0000-4000-8000-000000000006',
       1, 1, '[{"type":"timeline","eventKey":"t5:solo","description":"personal"}]', 'Solo summary', 0.50) $$,
  'T5: a personal-account owner commits to their own project'
);

set local role postgres;
select is(
  (select created_by from public.immutable_events where event_key = 't5:solo'),
  tests.get_supabase_uid('kb27_solo'),
  'T5: the event names the owner as its author'
);

-- ==================================
-- T6: anon
-- ==================================
set local role anon;
select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[]', 'anon', 0.10) $$,
  '42501', null,
  'T6: anon may not call it'
);

-- ==================================
-- T7: the team's owner (positive control)
-- ==================================
set local role postgres;
select pg_temp.reset_e();
select makerkit.authenticate_as('kb27_owner');

select lives_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"timeline","eventKey":"t7:owner","description":"owner"}]', 'Owner summary', 0.50) $$,
  'T7: the project owner commits'
);

set local role postgres;
select is(
  (select created_by from public.immutable_events where event_key = 't7:owner'),
  tests.get_supabase_uid('kb27_owner'),
  'T7: the event names the owner as its author'
);

-- ==================================
-- T8: all or nothing
-- ==================================
select makerkit.authenticate_as('kb27_owner');

select throws_ok(
  $$ select public.commit_canon_changes('27270000-0000-4000-8000-000000000001', '27270000-0000-4000-8000-000000000002',
       1, 1, '[{"type":"timeline","eventKey":"t7:owner","description":"again"}]', 'T8 summary', 0.50) $$,
  '23505', null,
  'T8: a duplicate event key is refused with its own SQLSTATE'
);

set local role postgres;
select is(pg_temp.e_summary(), 'Owner summary', 'T8: the refused commit stored no summary');

select * from finish();

rollback;
