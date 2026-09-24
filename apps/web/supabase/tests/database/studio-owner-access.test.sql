begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(88);

-- FILM-CC-04 KB-48. episode_facts, audio_cues, shot_transitions and
-- audio_assets tested a membership row only, which a personal account's owner
-- does not have. Each table now uses the studio rule its siblings use:
--
--   read   has_account_access(project.account_id)   personal owner, or a role on the account
--   write  can_write_project(project_id)            owner, admin or member in project_members
--
-- and three defects found with it:
--   R7  an episode could be linked to a fact of any project, any tenant; the
--       worker then reads the fact on the service role into this episode's story
--   R8  re-linking a linked fact (what .upsert() sends) was refused, for everyone
--   R9  audio_cues found the project through seasons, so a cue on an episode
--       with no season was invisible to everyone
--
-- Actors
--   kb48_p      personal account owner, creator (so owner) of project XP
--   kb48_tw     team: project member on XT            -> reads and writes XT
--   kb48_tv     team: project viewer on XT            -> reads XT, writes nothing
--   kb48_toff   team: account member, not on XT       -> reads XT, writes nothing
--   kb48_s      a stranger with a personal project XS -> nothing of XP or XT

select tests.create_supabase_user('kb48_p', 'kb48-p@storybook.dev');
select tests.create_supabase_user('kb48_towner', 'kb48-towner@storybook.dev');
select tests.create_supabase_user('kb48_tw', 'kb48-tw@storybook.dev');
select tests.create_supabase_user('kb48_tv', 'kb48-tv@storybook.dev');
select tests.create_supabase_user('kb48_toff', 'kb48-toff@storybook.dev');
select tests.create_supabase_user('kb48_s', 'kb48-s@storybook.dev');

-- Affected-row count of one statement, run as the caller (RLS turns a refused
-- UPDATE or DELETE into 0 rows, not an error).
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

-- ------------------------------------------------------------------
-- Fixtures, written as postgres. Each project is created while its
-- creator is authenticated, so add_project_owner makes them its owner.
-- ------------------------------------------------------------------
select makerkit.authenticate_as('kb48_p');
set local role postgres;
insert into public.projects (id, account_id, name, status) values
  ('4848a000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb48_p'), 'KB-48 personal', 'active');

select makerkit.authenticate_as('kb48_s');
set local role postgres;
insert into public.projects (id, account_id, name, status) values
  ('4848a000-0000-4000-8000-000000000004', tests.get_supabase_uid('kb48_s'), 'KB-48 stranger', 'active');

select makerkit.authenticate_as('kb48_towner');
set local role postgres;
select set_config('t.team', makerkit.get_account_id_by_slug('storybook')::text, true);
insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('kb48_towner'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb48_tw'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb48_tv'), current_setting('t.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb48_toff'), current_setting('t.team')::uuid, 'member');
insert into public.projects (id, account_id, name, status) values
  ('4848a000-0000-4000-8000-000000000002', current_setting('t.team')::uuid, 'KB-48 team', 'active'),
  ('4848a000-0000-4000-8000-000000000003', current_setting('t.team')::uuid, 'KB-48 team other', 'active');
insert into public.project_members (project_id, user_id, role) values
  ('4848a000-0000-4000-8000-000000000002', tests.get_supabase_uid('kb48_tw'), 'member'),
  ('4848a000-0000-4000-8000-000000000002', tests.get_supabase_uid('kb48_tv'), 'viewer');

insert into public.seasons (id, project_id, number) values
  ('4848a000-0000-4000-8000-0000000000a1', '4848a000-0000-4000-8000-000000000001', 1);

insert into public.episodes (id, project_id, season_id, number, title) values
  ('4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000001', '4848a000-0000-4000-8000-0000000000a1', 1, 'P in a season'),
  ('4848a000-0000-4000-8000-000000000012', '4848a000-0000-4000-8000-000000000001', null, 2, 'P no season'),
  ('4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000002', null, 1, 'T no season'),
  ('4848a000-0000-4000-8000-000000000014', '4848a000-0000-4000-8000-000000000004', null, 1, 'S');

insert into public.verified_facts (id, project_id, claim, source_type) values
  ('4848a000-0000-4000-8000-000000000021', '4848a000-0000-4000-8000-000000000001', 'P fact linked', 'textbook'),
  ('4848a000-0000-4000-8000-000000000022', '4848a000-0000-4000-8000-000000000001', 'P fact to link', 'textbook'),
  ('4848a000-0000-4000-8000-000000000023', '4848a000-0000-4000-8000-000000000002', 'T fact linked', 'textbook'),
  ('4848a000-0000-4000-8000-000000000024', '4848a000-0000-4000-8000-000000000003', 'T other-project fact', 'textbook'),
  ('4848a000-0000-4000-8000-000000000025', '4848a000-0000-4000-8000-000000000004', 'S secret fact', 'textbook'),
  ('4848a000-0000-4000-8000-000000000026', '4848a000-0000-4000-8000-000000000002', 'T fact to link', 'textbook');

insert into public.shots (id, episode_id, sequence_number, prompt) values
  ('4848a000-0000-4000-8000-000000000031', '4848a000-0000-4000-8000-000000000011', 1, 'P shot 1'),
  ('4848a000-0000-4000-8000-000000000032', '4848a000-0000-4000-8000-000000000011', 2, 'P shot 2'),
  ('4848a000-0000-4000-8000-000000000033', '4848a000-0000-4000-8000-000000000013', 1, 'T shot 1'),
  ('4848a000-0000-4000-8000-000000000034', '4848a000-0000-4000-8000-000000000013', 2, 'T shot 2');

insert into public.episode_facts (id, episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000041', '4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000021'),
  ('4848a000-0000-4000-8000-000000000042', '4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000023');

insert into public.audio_cues (id, episode_id, scene_number, cue_type, prompt) values
  ('4848a000-0000-4000-8000-000000000051', '4848a000-0000-4000-8000-000000000011', 1, 'sfx', 'P cue in a season'),
  ('4848a000-0000-4000-8000-000000000052', '4848a000-0000-4000-8000-000000000012', 1, 'sfx', 'P cue, no season'),
  ('4848a000-0000-4000-8000-000000000053', '4848a000-0000-4000-8000-000000000013', 1, 'sfx', 'T cue, no season');

insert into public.shot_transitions (id, episode_id, from_shot_id, to_shot_id) values
  ('4848a000-0000-4000-8000-000000000061', '4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000031', '4848a000-0000-4000-8000-000000000032'),
  ('4848a000-0000-4000-8000-000000000062', '4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000033', '4848a000-0000-4000-8000-000000000034');

insert into public.audio_assets (id, project_id, audio_type, prompt_hash, prompt) values
  ('4848a000-0000-4000-8000-000000000071', '4848a000-0000-4000-8000-000000000001', 'sfx', 'kb48-p', 'P asset'),
  ('4848a000-0000-4000-8000-000000000072', '4848a000-0000-4000-8000-000000000002', 'sfx', 'kb48-t', 'T asset');

-- ------------------------------------------------------------------
-- Personal owner (the ticket)
-- ------------------------------------------------------------------
select makerkit.authenticate_as('kb48_p');

select is((select count(*)::int from public.episode_facts where episode_id = '4848a000-0000-4000-8000-000000000011'), 1,
  'Personal owner reads their episode''s fact links');
select is((select count(*)::int from public.audio_cues where id in ('4848a000-0000-4000-8000-000000000051', '4848a000-0000-4000-8000-000000000052')), 2,
  'Personal owner reads their audio cues, including one on an episode with no season (R9)');
select is((select count(*)::int from public.shot_transitions where episode_id = '4848a000-0000-4000-8000-000000000011'), 1,
  'Personal owner reads their shot transitions');
select is((select count(*)::int from public.audio_assets where project_id = '4848a000-0000-4000-8000-000000000001'), 1,
  'Personal owner reads their audio assets');

select is(pg_temp.affected($$ update public.audio_cues set prompt = 'P edited' where id = '4848a000-0000-4000-8000-000000000051' $$), 1,
  'Personal owner updates their audio cue');
select is(pg_temp.affected($$ update public.shot_transitions set transition_type = 'fade' where id = '4848a000-0000-4000-8000-000000000061' $$), 1,
  'Personal owner updates their shot transition');
select is(pg_temp.affected($$ update public.audio_assets set prompt = 'P edited' where id = '4848a000-0000-4000-8000-000000000071' $$), 1,
  'Personal owner updates their audio asset');

select lives_ok($$ insert into public.episode_facts (id, episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000141', '4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000022') $$,
  'Personal owner links their fact to their episode');
select lives_ok($$ insert into public.audio_cues (id, episode_id, scene_number, cue_type, prompt) values
  ('4848a000-0000-4000-8000-000000000151', '4848a000-0000-4000-8000-000000000012', 2, 'sfx', 'P new cue') $$,
  'Personal owner adds an audio cue, on an episode with no season (R9)');
select lives_ok($$ insert into public.shot_transitions (id, episode_id, from_shot_id, to_shot_id) values
  ('4848a000-0000-4000-8000-000000000161', '4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000032', '4848a000-0000-4000-8000-000000000031') $$,
  'Personal owner adds a shot transition');
select lives_ok($$ insert into public.audio_assets (id, project_id, audio_type, prompt_hash, prompt) values
  ('4848a000-0000-4000-8000-000000000171', '4848a000-0000-4000-8000-000000000001', 'sfx', 'kb48-p2', 'P new asset') $$,
  'Personal owner adds an audio asset');

-- R8: the link already exists; this is the statement .upsert({ ignoreDuplicates: true }) sends.
select lives_ok($$ insert into public.episode_facts (episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000021')
  on conflict (episode_id, fact_id) do nothing $$,
  'Re-linking a fact that is already linked is a no-op, not a refusal (R8)');
select is((select count(*)::int from public.episode_facts
            where episode_id = '4848a000-0000-4000-8000-000000000011' and fact_id = '4848a000-0000-4000-8000-000000000021'), 1,
  'and it adds no second link');

-- R7: a fact of another tenant, which the owner cannot read.
select is((select count(*)::int from public.verified_facts where id = '4848a000-0000-4000-8000-000000000025'), 0,
  'setup: the personal owner cannot read the stranger''s fact');
select throws_ok($$ insert into public.episode_facts (episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000025') $$,
  '42501', null,
  'Linking another tenant''s fact to your own episode is refused (R7)');

select is(pg_temp.affected($$ delete from public.episode_facts where id = '4848a000-0000-4000-8000-000000000141' $$), 1,
  'Personal owner unlinks a fact');
select is(pg_temp.affected($$ delete from public.audio_cues where id = '4848a000-0000-4000-8000-000000000151' $$), 1,
  'Personal owner deletes an audio cue');
select is(pg_temp.affected($$ delete from public.shot_transitions where id = '4848a000-0000-4000-8000-000000000161' $$), 1,
  'Personal owner deletes a shot transition');
select is(pg_temp.affected($$ delete from public.audio_assets where id = '4848a000-0000-4000-8000-000000000171' $$), 1,
  'Personal owner deletes an audio asset');

select is((select count(*)::int from public.audio_cues where id = '4848a000-0000-4000-8000-000000000053'), 0,
  'Personal owner reads no other account''s audio cues');

-- ------------------------------------------------------------------
-- Team project member: reads and writes XT
-- ------------------------------------------------------------------
select makerkit.authenticate_as('kb48_tw');

select is((select count(*)::int from public.episode_facts where id = '4848a000-0000-4000-8000-000000000042'), 1, 'Project member reads fact links');
select is((select count(*)::int from public.audio_cues where id = '4848a000-0000-4000-8000-000000000053'), 1,
  'Project member reads an audio cue on an episode with no season (R9)');
select is((select count(*)::int from public.shot_transitions where id = '4848a000-0000-4000-8000-000000000062'), 1, 'Project member reads shot transitions');
select is((select count(*)::int from public.audio_assets where id = '4848a000-0000-4000-8000-000000000072'), 1, 'Project member reads audio assets');

select is(pg_temp.affected($$ update public.audio_cues set prompt = 'T edited' where id = '4848a000-0000-4000-8000-000000000053' $$), 1, 'Project member updates an audio cue');
select is(pg_temp.affected($$ update public.shot_transitions set transition_type = 'fade' where id = '4848a000-0000-4000-8000-000000000062' $$), 1, 'Project member updates a shot transition');
select is(pg_temp.affected($$ update public.audio_assets set prompt = 'T edited' where id = '4848a000-0000-4000-8000-000000000072' $$), 1, 'Project member updates an audio asset');

-- WITH CHECK: a row cannot be moved into a project the caller does not write to.
select throws_ok($$ update public.audio_cues set episode_id = '4848a000-0000-4000-8000-000000000011' where id = '4848a000-0000-4000-8000-000000000053' $$,
  '42501', null, 'Project member cannot move an audio cue onto another account''s episode');
select throws_ok($$ update public.shot_transitions set episode_id = '4848a000-0000-4000-8000-000000000011' where id = '4848a000-0000-4000-8000-000000000062' $$,
  '42501', null, 'Project member cannot move a shot transition onto another account''s episode');
select throws_ok($$ update public.audio_assets set project_id = '4848a000-0000-4000-8000-000000000001' where id = '4848a000-0000-4000-8000-000000000072' $$,
  '42501', null, 'Project member cannot move an audio asset into another account''s project');

select lives_ok($$ insert into public.episode_facts (id, episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000142', '4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000026') $$,
  'Project member links a fact of the same project');
select lives_ok($$ insert into public.audio_cues (id, episode_id, scene_number, cue_type, prompt) values
  ('4848a000-0000-4000-8000-000000000152', '4848a000-0000-4000-8000-000000000013', 2, 'sfx', 'T new cue') $$,
  'Project member adds an audio cue');
select lives_ok($$ insert into public.shot_transitions (id, episode_id, from_shot_id, to_shot_id) values
  ('4848a000-0000-4000-8000-000000000162', '4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000034', '4848a000-0000-4000-8000-000000000033') $$,
  'Project member adds a shot transition');
select lives_ok($$ insert into public.audio_assets (id, project_id, audio_type, prompt_hash, prompt) values
  ('4848a000-0000-4000-8000-000000000172', '4848a000-0000-4000-8000-000000000002', 'sfx', 'kb48-t2', 'T new asset') $$,
  'Project member adds an audio asset');

-- R7 inside one account: the member can read the other project's fact
-- (fact reads are account-scoped) and still may not link it here.
select is((select count(*)::int from public.verified_facts where id = '4848a000-0000-4000-8000-000000000024'), 1,
  'setup: the project member can read a fact of another project in the account');
select throws_ok($$ insert into public.episode_facts (episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000024') $$,
  '42501', null, 'Linking a fact of another project, same account, is refused (R7)');
select throws_ok($$ insert into public.episode_facts (episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000025') $$,
  '42501', null, 'Linking a fact of another tenant is refused (R7)');

select is(pg_temp.affected($$ delete from public.episode_facts where id = '4848a000-0000-4000-8000-000000000142' $$), 1, 'Project member unlinks a fact');
select is(pg_temp.affected($$ delete from public.audio_cues where id = '4848a000-0000-4000-8000-000000000152' $$), 1, 'Project member deletes an audio cue');
select is(pg_temp.affected($$ delete from public.shot_transitions where id = '4848a000-0000-4000-8000-000000000162' $$), 1, 'Project member deletes a shot transition');
select is(pg_temp.affected($$ delete from public.audio_assets where id = '4848a000-0000-4000-8000-000000000172' $$), 1, 'Project member deletes an audio asset');

-- ------------------------------------------------------------------
-- Project viewer and account member off the project: read, never write
-- ------------------------------------------------------------------
create function pg_temp.reads_but_cannot_write(who text) returns setof text
language plpgsql as $$
begin
  perform makerkit.authenticate_as(who);

  return next is((select count(*)::int from public.episode_facts where id = '4848a000-0000-4000-8000-000000000042'), 1, who || ' reads fact links');
  return next is((select count(*)::int from public.audio_cues where id = '4848a000-0000-4000-8000-000000000053'), 1, who || ' reads audio cues');
  return next is((select count(*)::int from public.shot_transitions where id = '4848a000-0000-4000-8000-000000000062'), 1, who || ' reads shot transitions');
  return next is((select count(*)::int from public.audio_assets where id = '4848a000-0000-4000-8000-000000000072'), 1, who || ' reads audio assets');

  return next throws_ok($q$ insert into public.episode_facts (episode_id, fact_id) values
    ('4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000026') $q$, '42501', null, who || ' cannot link a fact');
  return next throws_ok($q$ insert into public.audio_cues (episode_id, scene_number, cue_type, prompt) values
    ('4848a000-0000-4000-8000-000000000013', 9, 'sfx', 'x') $q$, '42501', null, who || ' cannot add an audio cue');
  return next throws_ok($q$ insert into public.shot_transitions (episode_id, to_shot_id) values
    ('4848a000-0000-4000-8000-000000000013', '4848a000-0000-4000-8000-000000000033') $q$, '42501', null, who || ' cannot add a shot transition');
  return next throws_ok($q$ insert into public.audio_assets (project_id, audio_type, prompt_hash, prompt) values
    ('4848a000-0000-4000-8000-000000000002', 'sfx', 'kb48-x', 'x') $q$, '42501', null, who || ' cannot add an audio asset');

  return next is(pg_temp.affected($q$ update public.audio_cues set prompt = 'x' where id = '4848a000-0000-4000-8000-000000000053' $q$), 0, who || ' cannot update an audio cue');
  return next is(pg_temp.affected($q$ update public.shot_transitions set transition_type = 'x' where id = '4848a000-0000-4000-8000-000000000062' $q$), 0, who || ' cannot update a shot transition');
  return next is(pg_temp.affected($q$ update public.audio_assets set prompt = 'x' where id = '4848a000-0000-4000-8000-000000000072' $q$), 0, who || ' cannot update an audio asset');

  return next is(pg_temp.affected($q$ delete from public.episode_facts where id = '4848a000-0000-4000-8000-000000000042' $q$), 0, who || ' cannot unlink a fact');
  return next is(pg_temp.affected($q$ delete from public.audio_cues where id = '4848a000-0000-4000-8000-000000000053' $q$), 0, who || ' cannot delete an audio cue');
  return next is(pg_temp.affected($q$ delete from public.shot_transitions where id = '4848a000-0000-4000-8000-000000000062' $q$), 0, who || ' cannot delete a shot transition');
  return next is(pg_temp.affected($q$ delete from public.audio_assets where id = '4848a000-0000-4000-8000-000000000072' $q$), 0, who || ' cannot delete an audio asset');
end;
$$;
grant execute on function pg_temp.reads_but_cannot_write(text) to authenticated;

select pg_temp.reads_but_cannot_write('kb48_tv');
select pg_temp.reads_but_cannot_write('kb48_toff');

-- ------------------------------------------------------------------
-- Stranger: nothing of XP or XT
-- ------------------------------------------------------------------
select makerkit.authenticate_as('kb48_s');

select is((select count(*)::int from public.episode_facts where id in ('4848a000-0000-4000-8000-000000000041', '4848a000-0000-4000-8000-000000000042')), 0, 'Stranger reads no fact links');
select is((select count(*)::int from public.audio_cues where id in ('4848a000-0000-4000-8000-000000000051', '4848a000-0000-4000-8000-000000000053')), 0, 'Stranger reads no audio cues');
select is((select count(*)::int from public.shot_transitions where id in ('4848a000-0000-4000-8000-000000000061', '4848a000-0000-4000-8000-000000000062')), 0, 'Stranger reads no shot transitions');
select is((select count(*)::int from public.audio_assets where id in ('4848a000-0000-4000-8000-000000000071', '4848a000-0000-4000-8000-000000000072')), 0, 'Stranger reads no audio assets');
select is((select count(*)::int from public.verified_facts where project_id in ('4848a000-0000-4000-8000-000000000001', '4848a000-0000-4000-8000-000000000002')), 0,
  'Stranger reads no facts of another tenant (FILM-1120)');

-- The stranger owns the fact; the episode is someone else's.
select throws_ok($$ insert into public.episode_facts (episode_id, fact_id) values
  ('4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000025') $$,
  '42501', null, 'Stranger cannot link their own fact into another tenant''s episode');
select throws_ok($$ insert into public.audio_cues (episode_id, scene_number, cue_type, prompt) values
  ('4848a000-0000-4000-8000-000000000011', 9, 'sfx', 'x') $$, '42501', null, 'Stranger cannot add an audio cue');
select throws_ok($$ insert into public.shot_transitions (episode_id, to_shot_id) values
  ('4848a000-0000-4000-8000-000000000011', '4848a000-0000-4000-8000-000000000031') $$, '42501', null, 'Stranger cannot add a shot transition');
select throws_ok($$ insert into public.audio_assets (project_id, audio_type, prompt_hash, prompt) values
  ('4848a000-0000-4000-8000-000000000001', 'sfx', 'kb48-y', 'x') $$, '42501', null, 'Stranger cannot add an audio asset');

select is(pg_temp.affected($$ update public.audio_cues set prompt = 'x' where id = '4848a000-0000-4000-8000-000000000051' $$), 0, 'Stranger cannot update an audio cue');
select is(pg_temp.affected($$ update public.shot_transitions set transition_type = 'x' where id = '4848a000-0000-4000-8000-000000000061' $$), 0, 'Stranger cannot update a shot transition');
select is(pg_temp.affected($$ update public.audio_assets set prompt = 'x' where id = '4848a000-0000-4000-8000-000000000071' $$), 0, 'Stranger cannot update an audio asset');
select is(pg_temp.affected($$ delete from public.episode_facts where id = '4848a000-0000-4000-8000-000000000041' $$), 0, 'Stranger cannot unlink a fact');
select is(pg_temp.affected($$ delete from public.audio_cues where id = '4848a000-0000-4000-8000-000000000051' $$), 0, 'Stranger cannot delete an audio cue');
select is(pg_temp.affected($$ delete from public.shot_transitions where id = '4848a000-0000-4000-8000-000000000061' $$), 0, 'Stranger cannot delete a shot transition');
select is(pg_temp.affected($$ delete from public.audio_assets where id = '4848a000-0000-4000-8000-000000000071' $$), 0, 'Stranger cannot delete an audio asset');

-- ------------------------------------------------------------------
-- Every policy on these tables names its role
-- ------------------------------------------------------------------
set local role postgres;
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public'
        and tablename in ('episode_facts', 'audio_cues', 'shot_transitions', 'audio_assets', 'verified_facts')
        and roles <> '{authenticated}' and roles <> '{service_role}' $$,
  'Every policy on the four tables and verified_facts is TO authenticated (or service_role)');

select * from finish();
rollback;
