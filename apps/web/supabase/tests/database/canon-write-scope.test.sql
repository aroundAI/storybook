begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-76, KB-77, KB-63. A fixed plan, so a run that aborts early fails as a
-- plan mismatch instead of reading as a nearly-passing suite.
select plan(155);

-- Seven canon tables took writes on has_role_on_account: every account
-- member, project viewers and members with no project row included, while
-- personal-account owners (no membership row) were shut out. Five had one
-- FOR ALL policy with no WITH CHECK (KB-76); character_states did not pin
-- its author and both append-only logs were granted UPDATE, DELETE and
-- TRUNCATE (KB-77); remove_episode_from_threads_touched had no check (KB-63).
--
-- The rules (owner's decisions of 2026-09-23 for KB-17/KB-27, and of
-- 2026-09-24 for this fix):
--   read    has_account_access on the project's account
--   write   can_write_project (owner, admin or member in project_members),
--           with every episode reference in the same project
--   logs    character_states and state_deltas are insert-only for clients;
--           a character state is authored by whoever inserts it
--   delete  none for clients on threads, world states, summaries and logs:
--           resets run in bulk_reset_episodes_to_stage (definer). Writers
--           may delete the two caches (act bridges, sequel contexts).
--
-- Fixtures:
--   T   team account of kb76_owner; kb76_member, kb76_viewer and
--       kb76_teammate have account roles. P, P2, P3 are T's projects:
--       kb76_member is a member and kb76_viewer a viewer of P; kb76_teammate
--       has no project row. E and E2 are P's episodes, A its character.
--   S   kb76_solo's personal project (episode F, character AS); S2 their
--       second project, a readable sequel parent.
--   X   kb76_stranger's personal project (episode EX, character AX).

select tests.create_supabase_user('kb76_owner', 'kb76-owner@storybook.dev');
select tests.create_supabase_user('kb76_member', 'kb76-member@storybook.dev');
select tests.create_supabase_user('kb76_viewer', 'kb76-viewer@storybook.dev');
select tests.create_supabase_user('kb76_teammate', 'kb76-teammate@storybook.dev');
select tests.create_supabase_user('kb76_solo', 'kb76-solo@storybook.dev');
select tests.create_supabase_user('kb76_stranger', 'kb76-stranger@storybook.dev');

select makerkit.authenticate_as('kb76_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('76760000-0000-4000-8000-00000000000a', 'KB-76 team', false, tests.get_supabase_uid('kb76_owner'));

insert into public.projects (id, account_id, name, status) values
  ('76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-00000000000a', 'KB-76 P', 'active'),
  ('76760000-0000-4000-8000-00000000000b', '76760000-0000-4000-8000-00000000000a', 'KB-76 P2', 'active'),
  ('76760000-0000-4000-8000-00000000000c', '76760000-0000-4000-8000-00000000000a', 'KB-76 P3', 'active');

select makerkit.authenticate_as('kb76_solo');
set local role postgres;

insert into public.projects (id, account_id, name, status) values
  ('76760000-0000-4000-8000-000000000005', tests.get_supabase_uid('kb76_solo'), 'KB-76 S', 'active'),
  ('76760000-0000-4000-8000-00000000000d', tests.get_supabase_uid('kb76_solo'), 'KB-76 S2', 'active');

select makerkit.authenticate_as('kb76_stranger');
set local role postgres;

insert into public.projects (id, account_id, name, status)
values ('76760000-0000-4000-8000-000000000008', tests.get_supabase_uid('kb76_stranger'), 'KB-76 X', 'active');

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('kb76_member'), '76760000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb76_viewer'), '76760000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('kb76_teammate'), '76760000-0000-4000-8000-00000000000a', 'member');

insert into public.project_members (project_id, user_id, role) values
  ('76760000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb76_member'), 'member'),
  ('76760000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb76_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title) values
  ('76760000-0000-4000-8000-000000000002', '76760000-0000-4000-8000-000000000001', 1, 'E'),
  ('76760000-0000-4000-8000-000000000003', '76760000-0000-4000-8000-000000000001', 2, 'E2'),
  ('76760000-0000-4000-8000-000000000006', '76760000-0000-4000-8000-000000000005', 1, 'F'),
  ('76760000-0000-4000-8000-000000000009', '76760000-0000-4000-8000-000000000008', 1, 'EX');

insert into public.assets (id, project_id, type, name) values
  ('76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-000000000001', 'character', 'A'),
  ('76760000-0000-4000-8000-000000000007', '76760000-0000-4000-8000-000000000005', 'character', 'AS'),
  ('76760000-0000-4000-8000-00000000000e', '76760000-0000-4000-8000-000000000008', 'character', 'AX');

-- One seeded row per table in P, written by the service path.
insert into public.narrative_threads (id, project_id, thread_name, opened_at, description, episodes_touched) values
  ('76760000-0000-4000-8000-000000000021', '76760000-0000-4000-8000-000000000001', 'seed thread',
   '76760000-0000-4000-8000-000000000002', 'original',
   array['76760000-0000-4000-8000-000000000002', '76760000-0000-4000-8000-000000000003']::uuid[]);
insert into public.world_states (id, project_id, episode_id, location, atmosphere) values
  ('76760000-0000-4000-8000-000000000022', '76760000-0000-4000-8000-000000000001',
   '76760000-0000-4000-8000-000000000002', 'seed', 'original');
insert into public.episode_summaries (id, episode_id, plot_summary) values
  ('76760000-0000-4000-8000-000000000023', '76760000-0000-4000-8000-000000000002', 'original');
insert into public.act_context_bridges (id, episode_id, act_number, act_title) values
  ('76760000-0000-4000-8000-000000000024', '76760000-0000-4000-8000-000000000002', 1, 'original');
insert into public.sequel_parent_contexts (id, sequel_project_id, parent_project_id, parent_summary) values
  ('76760000-0000-4000-8000-000000000025', '76760000-0000-4000-8000-000000000001',
   '76760000-0000-4000-8000-00000000000b', 'original');
insert into public.character_states (id, character_id, episode_id, state_type, state_value, trigger_event, created_by) values
  ('76760000-0000-4000-8000-000000000026', '76760000-0000-4000-8000-000000000004',
   '76760000-0000-4000-8000-000000000002', 'emotional', '{}', 'original', tests.get_supabase_uid('kb76_owner')),
  ('76760000-0000-4000-8000-000000000028', '76760000-0000-4000-8000-000000000004',
   '76760000-0000-4000-8000-000000000003', 'emotional', '{}', 'E2 state', tests.get_supabase_uid('kb76_owner'));
insert into public.state_deltas (id, episode_id, entity_type, entity_id, change_reason) values
  ('76760000-0000-4000-8000-000000000027', '76760000-0000-4000-8000-000000000002', 'character',
   '76760000-0000-4000-8000-000000000004', 'original'),
  ('76760000-0000-4000-8000-000000000029', '76760000-0000-4000-8000-000000000003', 'character',
   '76760000-0000-4000-8000-000000000004', 'E2 delta');

-- The same statement for every table, parameterised by project, episode,
-- character and sequel parent, so every role runs one matrix. A scratch
-- schema rather than pg_temp: authenticated cannot use this session's temp
-- schema, and the whole file rolls back.
create schema kb76;
grant usage on schema kb76 to authenticated;

create table kb76.canon (t text primary key, ord int);
insert into kb76.canon values
  ('narrative_threads', 1), ('world_states', 2), ('episode_summaries', 3), ('act_context_bridges', 4),
  ('sequel_parent_contexts', 5), ('character_states', 6), ('state_deltas', 7);
grant select on kb76.canon to authenticated;

create function kb76.ins(t text, p uuid, e uuid, a uuid, q uuid) returns text language sql immutable as $$
  select case t
    when 'narrative_threads' then format($f$insert into public.narrative_threads (project_id, thread_name, opened_at) values (%L, 'ins', %L)$f$, p, e)
    when 'world_states' then format($f$insert into public.world_states (project_id, episode_id, location) values (%L, %L, 'ins')$f$, p, e)
    when 'episode_summaries' then format($f$insert into public.episode_summaries (episode_id, plot_summary) values (%L, 'ins')$f$, e)
    when 'act_context_bridges' then format($f$insert into public.act_context_bridges (episode_id, act_number, act_title) values (%L, 2, 'ins')$f$, e)
    when 'sequel_parent_contexts' then format($f$insert into public.sequel_parent_contexts (sequel_project_id, parent_project_id) values (%L, %L)$f$, p, q)
    when 'character_states' then format($f$insert into public.character_states (character_id, episode_id, state_type, state_value, trigger_event, created_by) values (%L, %L, 'emotional', '{}', 'ins', auth.uid())$f$, a, e)
    when 'state_deltas' then format($f$insert into public.state_deltas (episode_id, entity_type, entity_id) values (%L, 'character', %L)$f$, e, a)
  end
$$;
grant execute on function kb76.ins(text, uuid, uuid, uuid, uuid) to authenticated;

-- The seeded row of each table, and how to change it.
create table kb76.seed (t text primary key, id uuid, upd text);
insert into kb76.seed values
  ('narrative_threads', '76760000-0000-4000-8000-000000000021', 'description = ''CHANGED'''),
  ('world_states', '76760000-0000-4000-8000-000000000022', 'atmosphere = ''CHANGED'''),
  ('episode_summaries', '76760000-0000-4000-8000-000000000023', 'plot_summary = ''CHANGED'''),
  ('act_context_bridges', '76760000-0000-4000-8000-000000000024', 'act_title = ''CHANGED'''),
  ('sequel_parent_contexts', '76760000-0000-4000-8000-000000000025', 'parent_summary = ''CHANGED'''),
  ('character_states', '76760000-0000-4000-8000-000000000026', 'trigger_event = ''CHANGED'''),
  ('state_deltas', '76760000-0000-4000-8000-000000000027', 'change_reason = ''CHANGED''');
grant select on kb76.seed to authenticated;

-- Rows of a table in P, counted under the caller's row-level security.
create function kb76.visible(t text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where id = %L', t, (select id from kb76.seed s where s.t = visible.t)) into n;
  return n;
end $$;
grant execute on function kb76.visible(text) to authenticated;

-- Has the seeded row been changed or removed? Read as postgres.
create function kb76.intact(t text) returns boolean language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where id = %L and not (%s)', t,
                 (select id from kb76.seed s where s.t = intact.t),
                 (select upd from kb76.seed s where s.t = intact.t)) into n;
  return n = 1;
end $$;

-- ==================================
-- R: who reads (7 tables x 5 callers)
-- ==================================
select makerkit.authenticate_as('kb76_owner');
select is(kb76.visible(t), 1::bigint, 'R: the project owner reads ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_member');
select is(kb76.visible(t), 1::bigint, 'R: a project member reads ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_viewer');
select is(kb76.visible(t), 1::bigint, 'R: a project viewer reads ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_teammate');
select is(kb76.visible(t), 1::bigint, 'R: a team member with no project row reads ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_stranger');
select is(kb76.visible(t), 0::bigint, 'R: someone outside the account reads no ' || t) from kb76.canon order by ord;

-- ==================================
-- I: who inserts (7 tables x 5 callers)
-- ==================================
select makerkit.authenticate_as('kb76_viewer');
select throws_ok(
  kb76.ins(t, '76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-000000000003',
           '76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-00000000000c'),
  '42501', null, 'I: a project viewer cannot insert ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_teammate');
select throws_ok(
  kb76.ins(t, '76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-000000000003',
           '76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-00000000000c'),
  '42501', null, 'I: a team member with no project row cannot insert ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_stranger');
select throws_ok(
  kb76.ins(t, '76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-000000000003',
           '76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-00000000000c'),
  '42501', null, 'I: someone outside the account cannot insert ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_member');
select lives_ok(
  kb76.ins(t, '76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-000000000003',
           '76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-00000000000c'),
  'I: a project member inserts ' || t) from kb76.canon order by ord;

select makerkit.authenticate_as('kb76_solo');
select lives_ok(
  kb76.ins(t, '76760000-0000-4000-8000-000000000005', '76760000-0000-4000-8000-000000000006',
           '76760000-0000-4000-8000-000000000007', '76760000-0000-4000-8000-00000000000d'),
  'I: a personal-account owner inserts ' || t || ' in their own project') from kb76.canon order by ord;

select is(
  (select count(*) from public.narrative_threads where project_id = '76760000-0000-4000-8000-000000000005'),
  1::bigint, 'I: and reads it back');

-- ==================================
-- X: no row points outside the writer's project
-- ==================================
select makerkit.authenticate_as('kb76_member');

select throws_ok(
  kb76.ins(t, '76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-000000000009',
           '76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-00000000000c'),
  '42501', null, 'X: a member cannot attach ' || t || ' in P to another account''s episode')
  from kb76.canon where t <> 'sequel_parent_contexts' order by ord;

select throws_ok(
  $$ insert into public.sequel_parent_contexts (sequel_project_id, parent_project_id)
     values ('76760000-0000-4000-8000-000000000001', '76760000-0000-4000-8000-000000000008') $$,
  '42501', null, 'X: a sequel cannot name a parent project the writer cannot read');

select throws_ok(
  $$ insert into public.character_states (character_id, episode_id, state_type, state_value, trigger_event, created_by)
     values ('76760000-0000-4000-8000-00000000000e', '76760000-0000-4000-8000-000000000002', 'emotional', '{}', 'x', auth.uid()) $$,
  '42501', null, 'X: a character state cannot be recorded for another account''s character');

select throws_ok(
  $$ update public.narrative_threads set project_id = '76760000-0000-4000-8000-000000000008'
      where id = '76760000-0000-4000-8000-000000000021' $$,
  '42501', null, 'X: a member cannot move a thread into another account''s project');

select throws_ok(
  $$ update public.narrative_threads set resolved_at = '76760000-0000-4000-8000-000000000009'
      where id = '76760000-0000-4000-8000-000000000021' $$,
  '42501', null, 'X: a thread cannot be resolved in another account''s episode');

select throws_ok(
  $$ update public.sequel_parent_contexts set parent_project_id = '76760000-0000-4000-8000-000000000008'
      where id = '76760000-0000-4000-8000-000000000025' $$,
  '42501', null, 'X: a sequel cannot be re-pointed at a parent the writer cannot read');

select throws_ok(
  $$ update public.world_states set episode_id = '76760000-0000-4000-8000-000000000009'
      where id = '76760000-0000-4000-8000-000000000022' $$,
  '42501', null, 'X: a world state cannot be moved to another account''s episode');

-- ==================================
-- A: character-state authorship (KB-77)
-- ==================================
select throws_ok(
  $$ insert into public.character_states (character_id, episode_id, state_type, state_value, trigger_event, created_by)
     values ('76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-000000000002', 'emotional', '{}', 'forged',
             tests.get_supabase_uid('kb76_owner')) $$,
  '42501', null, 'A: a member cannot record a character state in the owner''s name');

select throws_ok(
  $$ insert into public.character_states (character_id, episode_id, state_type, state_value, trigger_event)
     values ('76760000-0000-4000-8000-000000000004', '76760000-0000-4000-8000-000000000002', 'emotional', '{}', 'anonymous') $$,
  '42501', null, 'A: nor with no author');

-- ==================================
-- U: who updates (the five non-log tables; logs have no UPDATE at all)
-- ==================================
-- A refused USING matches no row and raises nothing, so each case checks the
-- row afterwards, as postgres.
select makerkit.authenticate_as('kb76_viewer');
select lives_ok(format('update public.%I set %s where id = %L', s.t, s.upd, s.id), 'U: a viewer''s update of ' || s.t || ' runs')
  from kb76.seed s join kb76.canon c using (t) where c.ord <= 5 order by c.ord;
set local role postgres;
select ok(kb76.intact(t), 'U: and changes no ' || t) from kb76.canon where ord <= 5 order by ord;

select makerkit.authenticate_as('kb76_teammate');
select lives_ok(format('update public.%I set %s where id = %L', s.t, s.upd, s.id), 'U: a no-project member''s update of ' || s.t || ' runs')
  from kb76.seed s join kb76.canon c using (t) where c.ord <= 5 order by c.ord;
set local role postgres;
select ok(kb76.intact(t), 'U: and changes no ' || t) from kb76.canon where ord <= 5 order by ord;

select makerkit.authenticate_as('kb76_member');
select throws_ok(format('update public.%I set %s where id = %L', s.t, s.upd, s.id),
                 '42501', 'permission denied for table ' || s.t, 'U: nobody may change a ' || s.t || ' entry')
  from kb76.seed s join kb76.canon c using (t) where c.ord > 5 order by c.ord;

select lives_ok(format('update public.%I set %s where id = %L', s.t, s.upd, s.id), 'U: a member updates ' || s.t)
  from kb76.seed s join kb76.canon c using (t) where c.ord <= 5 order by c.ord;
set local role postgres;
select ok(not kb76.intact(t), 'U: and the ' || t || ' row changed') from kb76.canon where ord <= 5 order by ord;

-- ==================================
-- D: who deletes
-- ==================================
-- Threads, world states, summaries and both logs: no client deletes them;
-- resets do, inside bulk_reset_episodes_to_stage.
select makerkit.authenticate_as('kb76_owner');
select throws_ok(format('delete from public.%I where id = %L', s.t, s.id),
                 '42501', 'permission denied for table ' || s.t, 'D: even the owner cannot delete a ' || s.t || ' row directly')
  from kb76.seed s join kb76.canon c using (t) where c.ord in (1, 2, 3, 6, 7) order by c.ord;

-- The two caches: writers only.
select makerkit.authenticate_as('kb76_viewer');
select lives_ok(format('delete from public.%I where id = %L', s.t, s.id), 'D: a viewer''s delete of ' || s.t || ' runs')
  from kb76.seed s join kb76.canon c using (t) where c.ord in (4, 5) order by c.ord;
set local role postgres;
select is(kb76.visible(t), 1::bigint, 'D: and removes no ' || t) from kb76.canon where ord in (4, 5) order by ord;

select makerkit.authenticate_as('kb76_member');
select lives_ok(format('delete from public.%I where id = %L', s.t, s.id), 'D: a member deletes ' || s.t)
  from kb76.seed s join kb76.canon c using (t) where c.ord in (4, 5) order by c.ord;
set local role postgres;
select is(kb76.visible(t), 0::bigint, 'D: and the ' || t || ' row is gone') from kb76.canon where ord in (4, 5) order by ord;

-- ==================================
-- P: privileges
-- ==================================
select table_privs_are('public', t::name, 'anon', array[]::name[], 'P: anon holds nothing on ' || t) from kb76.canon order by ord;

select table_privs_are('public', t::name, 'authenticated',
  case when t in ('character_states', 'state_deltas') then array['SELECT', 'INSERT']
       when t in ('narrative_threads', 'world_states', 'episode_summaries') then array['SELECT', 'INSERT', 'UPDATE']
       else array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] end,
  'P: authenticated holds exactly the verbs it needs on ' || t) from kb76.canon order by ord;

-- ==================================
-- F: remove_episode_from_threads_touched (KB-63)
-- ==================================
select ok(not has_function_privilege('authenticated', 'public.remove_episode_from_threads_touched(uuid, uuid)', 'execute'),
          'F: authenticated cannot call remove_episode_from_threads_touched');
select ok(not has_function_privilege('anon', 'public.remove_episode_from_threads_touched(uuid, uuid)', 'execute'),
          'F: nor can anon');

-- Called from definer code (here: as postgres) on behalf of a caller.
select makerkit.authenticate_as('kb76_viewer');
set local role postgres;
select throws_ok(
  $$ select public.remove_episode_from_threads_touched('76760000-0000-4000-8000-000000000003', '76760000-0000-4000-8000-000000000001') $$,
  '42501', null, 'F: it refuses a caller who cannot write the project');

select makerkit.authenticate_as('kb76_member');
set local role postgres;
select throws_ok(
  $$ select public.remove_episode_from_threads_touched('76760000-0000-4000-8000-000000000009', '76760000-0000-4000-8000-000000000001') $$,
  '42501', null, 'F: and an episode of another project');

select is(
  (select episodes_touched from public.narrative_threads where id = '76760000-0000-4000-8000-000000000021'),
  array['76760000-0000-4000-8000-000000000002', '76760000-0000-4000-8000-000000000003']::uuid[],
  'F: a refused call changes nothing');

-- ==================================
-- B: resetting one episode clears all of its canon (the reset path the
--    single-episode actions now use)
-- ==================================
select makerkit.authenticate_as('kb76_member');
select is(
  (public.bulk_reset_episodes_to_stage(array['76760000-0000-4000-8000-000000000003']::uuid[], 'story',
                                       '76760000-0000-4000-8000-00000000000a') ->> 'reset_count')::int,
  1, 'B: a member resets E2 to story');

set local role postgres;
select is((select count(*) from public.character_states where episode_id = '76760000-0000-4000-8000-000000000003'),
          0::bigint, 'B: E2''s character states are gone');
select is((select count(*) from public.state_deltas where episode_id = '76760000-0000-4000-8000-000000000003'),
          0::bigint, 'B: E2''s state deltas are gone');
select is((select count(*) from public.episode_summaries where episode_id = '76760000-0000-4000-8000-000000000003'),
          0::bigint, 'B: E2''s summary is gone');
select is(
  (select episodes_touched from public.narrative_threads where id = '76760000-0000-4000-8000-000000000021'),
  array['76760000-0000-4000-8000-000000000002']::uuid[],
  'B: E2 is no longer listed as touching the thread opened in E');
select is((select count(*) from public.character_states where episode_id = '76760000-0000-4000-8000-000000000002'),
          1::bigint, 'B: E''s own character state is untouched');

select * from finish();
rollback;
