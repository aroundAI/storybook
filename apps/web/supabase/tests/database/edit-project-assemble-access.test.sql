begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-40. A fixed plan, so a run that aborts early fails as a plan mismatch
-- instead of reading as a nearly-passing suite.
select plan(25);

-- batch_assemble_edit_project is SECURITY DEFINER, so row-level security does
-- not apply inside it, and it deletes the episode's edit project before
-- writing a new one. Before KB-40 it authorised a caller-supplied p_user_id
-- against account membership: any signed-in user naming the owner's id could
-- replace any episode's timeline.
--
-- The rule (owner's decision, 2026-09-23) is public.can_write_project for
-- auth.uid(): owner, admin or member in project_members.
--
-- Fixtures:
--   T   team account of kb40_owner. kb40_admin, kb40_member, kb40_viewer
--       and kb40_acctonly have account roles. P is T's PUBLIC project (the
--       stranger can read it); admin/member/viewer have project rows,
--       acctonly has none. E is P's episode, with the victim's edit project
--       EP (two tracks). ED is a soft-deleted episode of P.
--   S   kb40_stranger's project on their personal account, episode SE.
--
-- Every refused case asserts that EP still has both of its tracks, so a
-- refusal that raised after the delete would still fail here.

select tests.create_supabase_user('kb40_owner', 'kb40-owner@storybook.dev');
select tests.create_supabase_user('kb40_admin', 'kb40-admin@storybook.dev');
select tests.create_supabase_user('kb40_member', 'kb40-member@storybook.dev');
select tests.create_supabase_user('kb40_viewer', 'kb40-viewer@storybook.dev');
select tests.create_supabase_user('kb40_acctonly', 'kb40-acctonly@storybook.dev');
select tests.create_supabase_user('kb40_stranger', 'kb40-stranger@storybook.dev');

-- Accounts and projects are written with their owner's claims, so the
-- membership and creator triggers see the right auth.uid().
select makerkit.authenticate_as('kb40_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('40400000-0000-4000-8000-00000000000a', 'KB-40 team', false, tests.get_supabase_uid('kb40_owner'));

insert into public.projects (id, account_id, name, status, visibility)
values ('40400000-0000-4000-8000-000000000001', '40400000-0000-4000-8000-00000000000a', 'KB-40 P', 'active', 'public');

select makerkit.authenticate_as('kb40_stranger');
set local role postgres;

insert into public.projects (id, account_id, name, status)
values ('40400000-0000-4000-8000-000000000005', tests.get_supabase_uid('kb40_stranger'), 'KB-40 S', 'active');

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('kb40_admin'), '40400000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb40_member'), '40400000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb40_viewer'), '40400000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb40_acctonly'), '40400000-0000-4000-8000-00000000000a', 'member');

insert into public.project_members (project_id, user_id, role)
values
  ('40400000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb40_admin'), 'admin'),
  ('40400000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb40_member'), 'member'),
  ('40400000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb40_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title, deleted_at)
values
  ('40400000-0000-4000-8000-000000000002', '40400000-0000-4000-8000-000000000001', 1, 'E', null),
  ('40400000-0000-4000-8000-000000000003', '40400000-0000-4000-8000-000000000001', 2, 'ED', now()),
  ('40400000-0000-4000-8000-000000000006', '40400000-0000-4000-8000-000000000005', 1, 'SE', null);

insert into public.dialogue_lines (id, episode_id, text, sequence_number)
values ('40400000-0000-4000-8000-0000000000d1', '40400000-0000-4000-8000-000000000002', 'A line', 1);

insert into public.edit_projects (id, episode_id)
values ('40400000-0000-4000-8000-0000000000e1', '40400000-0000-4000-8000-000000000002');

insert into public.edit_tracks (edit_project_id, type, name, sort_order)
values
  ('40400000-0000-4000-8000-0000000000e1', 'video', 'Victim video', 0),
  ('40400000-0000-4000-8000-0000000000e1', 'dialogue', 'Victim dialogue', 1);

select is(
  (select count(*) from public.edit_tracks where edit_project_id = '40400000-0000-4000-8000-0000000000e1'),
  2::bigint,
  'Precondition: the victim edit project has its two tracks'
);

-- ==================================
-- Refused: nothing is deleted or written
-- ==================================

-- T1: the attack. A stranger who can read the public project calls the
-- function directly. Assert the read first, so the refusal cannot pass
-- merely because the episode was invisible.
select makerkit.authenticate_as('kb40_stranger');

select isnt_empty(
  $$ select id from public.projects where id = '40400000-0000-4000-8000-000000000001' $$,
  'Precondition: the stranger can read the public project'
);

select throws_ok(
  $$ select public.batch_assemble_edit_project(
       p_episode_id => '40400000-0000-4000-8000-000000000002',
       p_tracks => '[{"type":"video","name":"FORGED","sortOrder":0}]') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T1: a stranger cannot assemble another project''s episode'
);

set local role postgres;
select is(
  (select count(*) from public.edit_tracks where edit_project_id = '40400000-0000-4000-8000-0000000000e1'),
  2::bigint,
  'T1: the victim edit project is untouched'
);

-- T2: a project viewer (with an account role) may read but not write.
select makerkit.authenticate_as('kb40_viewer');

select throws_ok(
  $$ select public.batch_assemble_edit_project(
       p_episode_id => '40400000-0000-4000-8000-000000000002',
       p_tracks => '[{"type":"video","name":"FORGED","sortOrder":0}]') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T2: a project viewer cannot assemble'
);

set local role postgres;
select is(
  (select count(*) from public.edit_tracks where edit_project_id = '40400000-0000-4000-8000-0000000000e1'),
  2::bigint,
  'T2: the edit project is untouched'
);

-- T3: an account member with no project role.
select makerkit.authenticate_as('kb40_acctonly');

select throws_ok(
  $$ select public.batch_assemble_edit_project(
       p_episode_id => '40400000-0000-4000-8000-000000000002',
       p_tracks => '[{"type":"video","name":"FORGED","sortOrder":0}]') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T3: an account member without a project role cannot assemble'
);

set local role postgres;
select is(
  (select count(*) from public.edit_tracks where edit_project_id = '40400000-0000-4000-8000-0000000000e1'),
  2::bigint,
  'T3: the edit project is untouched'
);

-- T7: one error for every refusal, so the call says nothing about which
-- episodes exist.
select makerkit.authenticate_as('kb40_owner');

select throws_ok(
  $$ select public.batch_assemble_edit_project(p_episode_id => '40400000-0000-4000-8000-000000000003') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T7a: a soft-deleted episode is refused like any other, even for its owner'
);

select throws_ok(
  $$ select public.batch_assemble_edit_project(p_episode_id => '40400000-0000-4000-8000-0000000000ff') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T7b: a nonexistent episode is refused with the same error'
);

set local role postgres;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ select public.batch_assemble_edit_project(p_episode_id => '40400000-0000-4000-8000-000000000002') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T7c: a session with no user is refused'
);

-- The service role keeps EXECUTE but has no auth.uid(), so it is refused
-- too. Nothing in the product calls this function as the service role.
set local role postgres;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select throws_ok(
  $$ select public.batch_assemble_edit_project(p_episode_id => '40400000-0000-4000-8000-000000000002') $$,
  '42501',
  'No write access to this episode''s timeline',
  'T7d: the service role, having no user, is refused'
);

-- ==================================
-- Allowed: the project's writers
-- ==================================

-- T4: the owner, with a payload that exercises every step of the body
-- (tracks, a sync group anchored on a dialogue line, clips resolving
-- trackIndex/syncGroupIndex, primaryClipIndex, a keyframe) under the
-- function's empty search_path.
select makerkit.authenticate_as('kb40_owner');

select is(
  public.batch_assemble_edit_project(
    p_episode_id => '40400000-0000-4000-8000-000000000002',
    p_tracks => '[{"type":"video","name":"Owner video","sortOrder":0,"volume":1},{"type":"dialogue","name":"Owner dialogue","sortOrder":1}]',
    p_clips => '[{"trackIndex":0,"startMs":0,"endMs":1000,"outPointMs":1000},{"trackIndex":1,"startMs":0,"endMs":800,"outPointMs":800,"sourceDialogueId":"40400000-0000-4000-8000-0000000000d1","syncGroupIndex":0}]',
    p_keyframes => '[{"clipIndex":0,"property":"volume","offsetMs":0,"value":1}]',
    p_sync_groups => '[{"anchorDialogueId":"40400000-0000-4000-8000-0000000000d1","primaryClipIndex":1}]'
  ) - 'projectId',
  '{"trackCount": 2, "clipCount": 2, "keyframeCount": 1, "syncGroupCount": 1}'::jsonb,
  'T4: the owner assembles; the counts match the payload'
);

set local role postgres;

select results_eq(
  $$ select ep.id <> '40400000-0000-4000-8000-0000000000e1', string_agg(t.name, ',' order by t.sort_order)
       from public.edit_projects ep join public.edit_tracks t on t.edit_project_id = ep.id
      where ep.episode_id = '40400000-0000-4000-8000-000000000002'
      group by ep.id $$,
  $$ values (true, 'Owner video,Owner dialogue') $$,
  'T4: one edit project for the episode, a new one, with the payload''s tracks'
);

select is(
  (select count(*) from public.edit_clips c
     join public.edit_tracks t on t.id = c.track_id
     join public.edit_projects ep on ep.id = t.edit_project_id
    where ep.episode_id = '40400000-0000-4000-8000-000000000002'),
  2::bigint,
  'T4: both clips were written'
);

select ok(
  (select sg.primary_clip_id is not null
     from public.dialogue_sync_groups sg
     join public.edit_projects ep on ep.id = sg.edit_project_id
    where ep.episode_id = '40400000-0000-4000-8000-000000000002'),
  'T4: the sync group''s primary clip was resolved'
);

select is(
  (select count(*) from public.edit_keyframes k
     join public.edit_clips c on c.id = k.clip_id
     join public.edit_tracks t on t.id = c.track_id
     join public.edit_projects ep on ep.id = t.edit_project_id
    where ep.episode_id = '40400000-0000-4000-8000-000000000002'),
  1::bigint,
  'T4: the keyframe was written'
);

-- T4b, T5: a project admin and a project member.
select makerkit.authenticate_as('kb40_admin');
select lives_ok(
  $$ select public.batch_assemble_edit_project(
       p_episode_id => '40400000-0000-4000-8000-000000000002',
       p_tracks => '[{"type":"video","name":"Admin video","sortOrder":0}]') $$,
  'T4b: a project admin assembles'
);

select makerkit.authenticate_as('kb40_member');
select lives_ok(
  $$ select public.batch_assemble_edit_project(
       p_episode_id => '40400000-0000-4000-8000-000000000002',
       p_tracks => '[{"type":"video","name":"Member video","sortOrder":0}]') $$,
  'T5: a project member assembles'
);

-- T6: a personal-account owner on their own project. Personal accounts have
-- no accounts_memberships row, so the old account-membership rule refused
-- them; the creator's owner row in project_members is what lets them write.
select makerkit.authenticate_as('kb40_stranger');
select lives_ok(
  $$ select public.batch_assemble_edit_project(
       p_episode_id => '40400000-0000-4000-8000-000000000006',
       p_tracks => '[{"type":"video","name":"Personal video","sortOrder":0}]') $$,
  'T6: a personal-account owner assembles on their own project'
);

-- ==================================
-- The function itself
-- ==================================

set local role postgres;

select ok(
  not has_function_privilege('anon', 'public.batch_assemble_edit_project(uuid, integer, integer, integer, varchar, text, text, text, text)', 'EXECUTE'),
  'T8a: anon cannot execute it'
);

select ok(
  has_function_privilege('authenticated', 'public.batch_assemble_edit_project(uuid, integer, integer, integer, varchar, text, text, text, text)', 'EXECUTE'),
  'T8b: authenticated can execute it (the edit suite calls it with the user''s session)'
);

select ok(
  has_function_privilege('service_role', 'public.batch_assemble_edit_project(uuid, integer, integer, integer, varchar, text, text, text, text)', 'EXECUTE'),
  'T8c: service_role can execute it'
);

select hasnt_function(
  'public', 'batch_assemble_edit_project',
  array['uuid', 'uuid', 'integer', 'integer', 'integer', 'character varying', 'text', 'text', 'text', 'text'],
  'T9: no version takes a caller-supplied user id'
);

select is(
  (select proconfig from pg_proc where oid = 'public.batch_assemble_edit_project(uuid, integer, integer, integer, varchar, text, text, text, text)'::regprocedure),
  array['search_path=""'],
  'T10: its search_path is pinned empty'
);

select * from finish();

rollback;
