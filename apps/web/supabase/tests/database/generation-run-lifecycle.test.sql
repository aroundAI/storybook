begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(34);

-- FILM-1903 part B: the lifecycle functions a run is driven through, with
-- real roles. openRun, renewLease, the status transitions and the revision
-- snapshot all go through SECURITY DEFINER functions, because authenticated
-- has no write privilege on generation_runs and the MCP path never uses the
-- service role for a user. Each gate is exercised here, not read.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner   creates project P -> project owner (writes)
--   member  account member, not on project_members -> reads P, drives nothing
--   lc_out  a stranger -> nothing

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('lc_out', 'lc-out@storybook.dev');

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('lc.team', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('lc.owner', tests.get_supabase_uid('owner')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19031000-0000-4000-8000-000000000001', current_setting('lc.team')::uuid, 'FILM-1903 lifecycle', 'active');

insert into public.episodes (id, project_id, number, title, story_data) values
  ('19031000-0000-4000-8000-000000000011', '19031000-0000-4000-8000-000000000001', 1, 'Ep 1', '{"v": 1}'::jsonb);

-- ------------------------------------------------------------------
-- open_generation_run
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');

select set_config('lc.open1', public.open_generation_run(
  p_account_id := current_setting('lc.team')::uuid,
  p_project_id := '19031000-0000-4000-8000-000000000001',
  p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
  p_stage := 'story', p_mode := 'server',
  p_input := '{"kind": "job", "jobType": "story-generation", "payload": {"title": "T"}}'::jsonb,
  p_origin := '{"kind": "web", "name": "episodes.generateStory"}'::jsonb
)::text, true);

select is(
  (current_setting('lc.open1')::jsonb ->> 'ok')::boolean, true,
  'O1 a project owner opens a server run'
);

select is(
  (select created_by from public.generation_runs where id = (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid),
  current_setting('lc.owner')::uuid,
  'O1 created_by is the caller, whatever the arguments say'
);

select is(
  (select input from public.generation_runs where id = (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid),
  '{"kind": "job", "jobType": "story-generation", "payload": {"title": "T"}}'::jsonb,
  'O1 the run carries what it was asked to do'
);

select ok(
  (select lease_expires_at > now() + interval '29 minutes' from public.generation_runs
   where id = (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid),
  'O1 a new run holds a 30-minute lease'
);

select is(
  current_setting('lc.open1')::jsonb -> 'run' ->> 'status', 'briefed',
  'O1 a new run is briefed'
);

select set_config('lc.open2', public.open_generation_run(
  p_account_id := current_setting('lc.team')::uuid,
  p_project_id := '19031000-0000-4000-8000-000000000001',
  p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
  p_stage := 'story', p_mode := 'external',
  p_input := '{}'::jsonb,
  p_origin := '{}'::jsonb
)::text, true);

select is(
  current_setting('lc.open2')::jsonb ->> 'code', 'RUN_IN_PROGRESS',
  'O2 a second open run on the same target and stage is refused as RUN_IN_PROGRESS'
);

select is(
  current_setting('lc.open2')::jsonb -> 'holder' ->> 'id',
  current_setting('lc.open1')::jsonb -> 'run' ->> 'id',
  'O2 the refusal names the holder'
);

select is(
  (current_setting('lc.open2')::jsonb -> 'holder' ->> 'created_by')::uuid,
  current_setting('lc.owner')::uuid,
  'O2 the holder says who opened it'
);

-- another stage on the same episode is a different lock
select is(
  (public.open_generation_run(
    p_account_id := current_setting('lc.team')::uuid,
    p_project_id := '19031000-0000-4000-8000-000000000001',
    p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
    p_stage := 'shots', p_mode := 'server',
    p_input := '{}'::jsonb,
    p_origin := '{}'::jsonb
  ) ->> 'ok')::boolean, true,
  'O3 a run on another stage of the same episode opens'
);

-- the three new stage keys and the two new target types are accepted
select is(
  (public.open_generation_run(
    p_account_id := current_setting('lc.team')::uuid,
    p_project_id := '19031000-0000-4000-8000-000000000001',
    p_target_type := 'project', p_target_id := '19031000-0000-4000-8000-000000000001',
    p_stage := 'analytics_insights', p_mode := 'server',
    p_input := '{}'::jsonb,
    p_origin := '{}'::jsonb
  ) ->> 'ok')::boolean, true,
  'O4 analytics_insights on a project target opens'
);

-- the story page's documentary fact check (FILM-1902): a server-only key
select is(
  (public.open_generation_run(
    p_account_id := current_setting('lc.team')::uuid,
    p_project_id := '19031000-0000-4000-8000-000000000001',
    p_target_type := 'project', p_target_id := '19031000-0000-4000-8000-000000000001',
    p_stage := 'fact_check', p_mode := 'server',
    p_input := '{}'::jsonb,
    p_origin := '{}'::jsonb
  ) ->> 'ok')::boolean, true,
  'O4 fact_check on a project target opens'
);

select is(
  (public.open_generation_run(
    p_account_id := current_setting('lc.team')::uuid,
    p_project_id := '19031000-0000-4000-8000-000000000001',
    p_target_type := 'audio_cue', p_target_id := '19031000-0000-4000-8000-0000000000cc',
    p_stage := 'audio_render', p_mode := 'server',
    p_input := '{}'::jsonb,
    p_origin := '{}'::jsonb
  ) ->> 'ok')::boolean, true,
  'O4 audio_render on a cue target opens'
);

-- a run with no project: the team's, by a member of the team; never a
-- personal account (KB-99), never another team
select is(
  (public.open_generation_run(
    p_account_id := current_setting('lc.team')::uuid,
    p_project_id := null,
    p_target_type := 'publish', p_target_id := '19031000-0000-4000-8000-0000000000bb',
    p_stage := 'publish_metadata', p_mode := 'server',
    p_input := '{}'::jsonb,
    p_origin := '{}'::jsonb
  ) ->> 'ok')::boolean, true,
  'O5 a run with no project opens on a team the caller belongs to'
);

select throws_like(
  $$ select public.open_generation_run(
       p_account_id := current_setting('lc.owner')::uuid,
       p_project_id := null,
       p_target_type := 'publish', p_target_id := '19031000-0000-4000-8000-0000000000bd',
       p_stage := 'publish_metadata', p_mode := 'server',
       p_input := '{}'::jsonb,
       p_origin := '{}'::jsonb) $$,
  '%belong to a team account%',
  'O5 a run on a personal account is refused, saying why (KB-99)'
);

select makerkit.authenticate_as('lc_out');

select throws_like(
  $$ select public.open_generation_run(
       p_account_id := current_setting('lc.team')::uuid,
       p_project_id := null,
       p_target_type := 'publish', p_target_id := '19031000-0000-4000-8000-0000000000be',
       p_stage := 'publish_metadata', p_mode := 'server',
       p_input := '{}'::jsonb,
       p_origin := '{}'::jsonb) $$,
  '%refused: no write access%',
  'O5 a run with no project on a team the caller is not in is refused'
);

select makerkit.authenticate_as('owner');

-- an account member who is not on the project may not open a run on it
select makerkit.authenticate_as('member');

select throws_like(
  $$ select public.open_generation_run(
       p_account_id := current_setting('lc.team')::uuid,
       p_project_id := '19031000-0000-4000-8000-000000000001',
       p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
       p_stage := 'screenplay', p_mode := 'server',
       p_input := '{}'::jsonb,
       p_origin := '{}'::jsonb
     ) $$,
  '%refused: no write access%',
  'O6 an account member without a project role is refused'
);

select makerkit.authenticate_as('lc_out');

select throws_like(
  $$ select public.open_generation_run(
       p_account_id := current_setting('lc.team')::uuid,
       p_project_id := '19031000-0000-4000-8000-000000000001',
       p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
       p_stage := 'screenplay', p_mode := 'server',
       p_input := '{}'::jsonb,
       p_origin := '{}'::jsonb
     ) $$,
  '%refused: no write access%',
  'O6 a stranger is refused'
);

-- the worker (service role) opens a child run for the parent's user
select tests.authenticate_as_service_role();

select set_config('lc.child', public.open_generation_run(
  p_account_id := current_setting('lc.team')::uuid,
  p_project_id := '19031000-0000-4000-8000-000000000001',
  p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
  p_stage := 'audio_cues', p_mode := 'server',
  p_input := '{}'::jsonb,
  p_origin := '{}'::jsonb,
  p_parent_run_id := (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid,
  p_created_by := current_setting('lc.owner')::uuid
)::text, true);

select is(
  (current_setting('lc.child')::jsonb ->> 'ok')::boolean, true,
  'O7 the service role opens a child run'
);

select is(
  (select created_by from public.generation_runs where id = (current_setting('lc.child')::jsonb -> 'run' ->> 'id')::uuid),
  current_setting('lc.owner')::uuid,
  'O7 the child is the parent''s user'
);

select throws_like(
  $$ select public.open_generation_run(
       p_account_id := current_setting('lc.team')::uuid,
       p_project_id := '19031000-0000-4000-8000-000000000001',
       p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
       p_stage := 'dialogue_translation', p_mode := 'external',
       p_input := '{}'::jsonb,
       p_origin := '{}'::jsonb,
       p_parent_run_id := (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid,
       p_created_by := current_setting('lc.owner')::uuid
     ) $$,
  '%child run takes its parent''s account and mode%',
  'O7 a child in another mode than its parent is refused'
);

select throws_like(
  $$ select public.open_generation_run(
       p_account_id := current_setting('lc.team')::uuid,
       p_project_id := '19031000-0000-4000-8000-000000000001',
       p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
       p_stage := 'dialogue_translation', p_mode := 'server',
       p_input := '{}'::jsonb,
       p_origin := '{}'::jsonb
     ) $$,
  '%a run needs the user it is opened for%',
  'O7 the service role must name the user'
);

-- ------------------------------------------------------------------
-- renew_generation_run_lease
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
set local role postgres;
update public.generation_runs set lease_expires_at = now() + interval '1 minute'
where id = (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid;
select makerkit.authenticate_as('owner');

select is(
  (public.renew_generation_run_lease((current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid) ->> 'ok')::boolean,
  true,
  'R1 the project owner renews an open run'
);

select ok(
  (select lease_expires_at > now() + interval '29 minutes' from public.generation_runs
   where id = (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid),
  'R1 the lease is 30 minutes from now again'
);

select makerkit.authenticate_as('member');

select throws_like(
  $$ select public.renew_generation_run_lease((current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid) $$,
  '%refused: no write access%',
  'R2 a member without a project role cannot renew'
);

select is(
  public.renew_generation_run_lease('19031000-0000-4000-8000-0000000000ff') ->> 'code',
  'RUN_NOT_FOUND',
  'R3 an unknown run is RUN_NOT_FOUND, not an error'
);

-- an expired lease is not renewed: the writer must refuse
select makerkit.authenticate_as('owner');
set local role postgres;
update public.generation_runs set lease_expires_at = now() - interval '1 minute'
where id = (current_setting('lc.child')::jsonb -> 'run' ->> 'id')::uuid;
select makerkit.authenticate_as('owner');

select is(
  public.renew_generation_run_lease((current_setting('lc.child')::jsonb -> 'run' ->> 'id')::uuid) ->> 'code',
  'RUN_NOT_OPEN',
  'R4 a run past its lease answers RUN_NOT_OPEN'
);

-- ------------------------------------------------------------------
-- transition_generation_run
-- ------------------------------------------------------------------
select is(
  public.transition_generation_run((current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid, 'in_progress') -> 'run' ->> 'status',
  'in_progress',
  'T1 briefed -> in_progress'
);

select set_config('lc.committed', public.transition_generation_run(
  (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid, 'committed'
)::text, true);

select ok(
  (current_setting('lc.committed')::jsonb -> 'run' ->> 'finalized_at') is not null
  and current_setting('lc.committed')::jsonb -> 'run' ->> 'status' = 'committed',
  'T2 in_progress -> committed sets finalized_at'
);

select is(
  public.transition_generation_run((current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid, 'failed', '{"code": "X"}'::jsonb) ->> 'code',
  'RUN_NOT_OPEN',
  'T3 a committed run never moves again'
);

select throws_like(
  $$ select public.transition_generation_run((current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid, 'briefed') $$,
  '%cannot be moved to briefed%',
  'T4 a run cannot go back to briefed'
);

-- the committed run frees the target: a new story run opens, and a
-- cancelled one frees it too
select set_config('lc.open3', public.open_generation_run(
  p_account_id := current_setting('lc.team')::uuid,
  p_project_id := '19031000-0000-4000-8000-000000000001',
  p_target_type := 'episode', p_target_id := '19031000-0000-4000-8000-000000000011',
  p_stage := 'story', p_mode := 'external',
  p_input := '{}'::jsonb,
  p_origin := '{}'::jsonb
)::text, true);

select is(
  (current_setting('lc.open3')::jsonb ->> 'ok')::boolean, true,
  'T5 after the commit a new run on the target opens'
);

select is(
  public.transition_generation_run((current_setting('lc.open3')::jsonb -> 'run' ->> 'id')::uuid, 'cancelled', '{"code": "CANCELLED", "by": "user"}'::jsonb) -> 'run' ->> 'error',
  '{"by": "user", "code": "CANCELLED"}',
  'T6 cancel records why'
);

-- ------------------------------------------------------------------
-- record_content_revision
-- ------------------------------------------------------------------
select set_config('lc.rev', public.record_content_revision(
  (current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid,
  '{"episode": {"story_data": {"v": 1}}}'::jsonb
)::text, true);

select results_eq(
  format($$ select target_type, target_id, stage, run_id from public.content_revisions where id = %L $$, current_setting('lc.rev')),
  format($$ values ('episode', %L::uuid, 'story', %L::uuid) $$,
    '19031000-0000-4000-8000-000000000011', current_setting('lc.open1')::jsonb -> 'run' ->> 'id'),
  'V1 the revision files under the run''s target and stage'
);

select makerkit.authenticate_as('member');

select throws_like(
  $$ select public.record_content_revision((current_setting('lc.open1')::jsonb -> 'run' ->> 'id')::uuid, '{}'::jsonb) $$,
  '%refused: no write access%',
  'V2 a member without a project role cannot record a revision'
);

select * from finish();
rollback;
