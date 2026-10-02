begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count, so a run that aborts early fails as a plan mismatch rather
-- than reading like a nearly-passing suite (revenue-records-rls.test.sql).
select plan(45);

-- FILM-1903 part A: the database half of generation runs. Every lock, the
-- one-open-run index, the read policies, the owner-only settings write and
-- the restore function are exercised with real roles here, not read.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner      creates project P, so add_project_owner makes them its project owner (writes)
--   member     account member, not on project_members -> reads P, writes nothing
--   gr_out     a stranger with their own team of one   -> sees nothing of P

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('gr_out', 'gr-out@storybook.dev');

-- KB-99: a solo user is a team of one
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

-- Affected-row count of one statement, run as the caller (RLS turns a
-- refused UPDATE into 0 rows, not an error).
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
-- Fixtures, written as postgres
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('gr.team', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('gr.owner', tests.get_supabase_uid('owner')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19030000-0000-4000-8000-000000000001', current_setting('gr.team')::uuid, 'FILM-1903 runs', 'active');

insert into public.episodes (id, project_id, number, title, story_data) values
  ('19030000-0000-4000-8000-000000000011', '19030000-0000-4000-8000-000000000001', 1, 'Ep 1', '{"v": 1}'::jsonb),
  ('19030000-0000-4000-8000-000000000012', '19030000-0000-4000-8000-000000000001', 2, 'Ep 2', null);

select makerkit.authenticate_as('gr_out');
set local role postgres;
insert into public.projects (id, account_id, name, status) values
  ('19030000-0000-4000-8000-000000000002', pg_temp.solo_team('gr_out'), 'FILM-1903 stranger', 'active');

-- ------------------------------------------------------------------
-- Runs open in either mode
-- ------------------------------------------------------------------
-- an external run on Ep 1 / story
insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by, lease_expires_at)
values ('19030000-0000-4000-8000-0000000000e1', current_setting('gr.team')::uuid,
        '19030000-0000-4000-8000-000000000001', 'episode', '19030000-0000-4000-8000-000000000011',
        'story', 'external', current_setting('gr.owner')::uuid, now() + interval '30 minutes');

-- a server run on Ep 2 / story
insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by)
values ('19030000-0000-4000-8000-0000000000a1', current_setting('gr.team')::uuid,
        '19030000-0000-4000-8000-000000000001', 'episode', '19030000-0000-4000-8000-000000000012',
        'story', 'server', current_setting('gr.owner')::uuid);

-- a committed server run on Ep 2 / shots
insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, status, created_by, finalized_at)
values ('19030000-0000-4000-8000-0000000000a2', current_setting('gr.team')::uuid,
        '19030000-0000-4000-8000-000000000001', 'episode', '19030000-0000-4000-8000-000000000012',
        'shots', 'server', 'committed', current_setting('gr.owner')::uuid, now());

insert into public.generation_run_parts (run_id, part_key, output)
values ('19030000-0000-4000-8000-0000000000e1', 'story', '{"premise": "a part"}'::jsonb);

insert into public.content_revisions (id, account_id, target_type, target_id, stage, run_id, snapshot)
values ('19030000-0000-4000-8000-0000000000c1', current_setting('gr.team')::uuid, 'episode',
        '19030000-0000-4000-8000-000000000012', 'shots', '19030000-0000-4000-8000-0000000000a2', '{"shots": []}'::jsonb);

-- ------------------------------------------------------------------
-- Lock 1: an LLM job exists only for an open server-mode run
-- ------------------------------------------------------------------
select throws_like(
  $$ insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data, run_id)
     values ('gr-job-ext', current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001',
             'story', '{}'::jsonb, '19030000-0000-4000-8000-0000000000e1') $$,
  '%generation_jobs row for run%not an open server-mode run%',
  'L1 a story job on an external run is refused'
);

select throws_like(
  $$ insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data, run_id)
     values ('gr-job-closed', current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001',
             'shot_list', '{}'::jsonb, '19030000-0000-4000-8000-0000000000a2') $$,
  '%not an open server-mode run%',
  'L1 a shot_list job on a committed server run is refused: the run is closed'
);

-- 'asset_creation' is the job type KB-174 (#553) adds; a BEFORE trigger fires
-- before the CHECK, so the lock refuses it whether or not #553 has merged
select throws_like(
  $$ insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data, run_id)
     values ('gr-job-asset', current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001',
             'asset_creation', '{}'::jsonb, '19030000-0000-4000-8000-0000000000e1') $$,
  '%not an open server-mode run%',
  'L1 an asset_creation job on an external run is refused'
);

select lives_ok(
  $$ insert into public.generation_jobs (id, idempotency_key, account_id, project_id, job_type, input_data, run_id)
     values ('19030000-0000-4000-8000-0000000000d1', 'gr-job-srv', current_setting('gr.team')::uuid,
             '19030000-0000-4000-8000-000000000001', 'story', '{}'::jsonb, '19030000-0000-4000-8000-0000000000a1') $$,
  'L1 a story job on an open server run is accepted'
);

select lives_ok(
  $$ insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data, run_id)
     values ('gr-job-voice', current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001',
             'voice', '{}'::jsonb, '19030000-0000-4000-8000-0000000000e1') $$,
  'L1 a voice render on an external run is accepted: the lock covers LLM job types only'
);

select lives_ok(
  $$ insert into public.generation_jobs (id, idempotency_key, account_id, project_id, job_type, input_data)
     values ('19030000-0000-4000-8000-0000000000d2', 'gr-job-norun', current_setting('gr.team')::uuid,
             '19030000-0000-4000-8000-000000000001', 'story', '{}'::jsonb) $$,
  'L1 part A: a story job with no run is still accepted (NOT NULL is part C)'
);

select throws_like(
  $$ update public.generation_jobs set run_id = '19030000-0000-4000-8000-0000000000e1'
      where id = '19030000-0000-4000-8000-0000000000d2' $$,
  '%not an open server-mode run%',
  'L1 attaching an existing job to an external run is refused too'
);

-- ------------------------------------------------------------------
-- Lock 2: a usage row exists only for an open server-mode run
-- ------------------------------------------------------------------
select throws_like(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status, run_id)
     values (current_setting('gr.team')::uuid, 'story-generation', 'gemini', 'gemini-2.5-pro', 'success',
             '19030000-0000-4000-8000-0000000000e1') $$,
  '%llm_usage_analytics row for run%not an open server-mode run%',
  'L2 a usage row for an external run is refused'
);

select lives_ok(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status, run_id)
     values (current_setting('gr.team')::uuid, 'story-generation', 'gemini', 'gemini-2.5-pro', 'success',
             '19030000-0000-4000-8000-0000000000a1') $$,
  'L2 a usage row for an open server run is accepted'
);

select lives_ok(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status)
     values (current_setting('gr.team')::uuid, 'story-generation', 'gemini', 'gemini-2.5-pro', 'success') $$,
  'L2 part A: a usage row with no run is still accepted (NOT NULL is part C)'
);

-- ------------------------------------------------------------------
-- Lock 3: a run opened from an MCP connection is external
-- ------------------------------------------------------------------
select throws_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, connection_id, created_by)
     values (current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001', 'episode',
             '19030000-0000-4000-8000-000000000012', 'ideation', 'server',
             '19030000-0000-4000-8000-0000000000cc', current_setting('gr.owner')::uuid) $$,
  '23514',
  'new row for relation "generation_runs" violates check constraint "mcp_runs_are_external"',
  'L3 a server-mode run with a connection id is refused'
);

select lives_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, connection_id, created_by)
     values (current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001', 'episode',
             '19030000-0000-4000-8000-000000000012', 'ideation', 'external',
             '19030000-0000-4000-8000-0000000000cc', current_setting('gr.owner')::uuid) $$,
  'L3 an external run with a connection id is accepted'
);

select throws_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, created_by)
     values (current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001', 'episode',
             '19030000-0000-4000-8000-000000000012', 'not_a_stage', 'server', current_setting('gr.owner')::uuid) $$,
  '23514',
  'new row for relation "generation_runs" violates check constraint "generation_runs_stage_check"',
  'a stage outside the FILM-1901 registry is refused'
);

-- ------------------------------------------------------------------
-- One open run per (target_type, target_id, stage)
-- ------------------------------------------------------------------
select throws_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, created_by)
     values (current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001', 'episode',
             '19030000-0000-4000-8000-000000000011', 'story', 'server', current_setting('gr.owner')::uuid) $$,
  '23505',
  'duplicate key value violates unique constraint "generation_runs_one_open"',
  'U1 a second run on Ep 1 / story is refused while the external run is open'
);

select lives_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, created_by)
     values (current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001', 'episode',
             '19030000-0000-4000-8000-000000000011', 'screenplay', 'server', current_setting('gr.owner')::uuid) $$,
  'U1 a run on the same episode for another stage opens'
);

update public.generation_runs set status = 'cancelled', finalized_at = now()
 where id = '19030000-0000-4000-8000-0000000000e1';

select lives_ok(
  $$ insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by, lease_expires_at)
     values ('19030000-0000-4000-8000-0000000000e2', current_setting('gr.team')::uuid,
             '19030000-0000-4000-8000-000000000001', 'episode', '19030000-0000-4000-8000-000000000011',
             'story', 'server', current_setting('gr.owner')::uuid, now() - interval '1 minute') $$,
  'U1 after the holder is cancelled, a new run on Ep 1 / story opens'
);

-- ------------------------------------------------------------------
-- Expiry frees the target
-- ------------------------------------------------------------------
select is(
  public.expire_generation_runs(),
  1,
  'X1 expire_generation_runs() expires the one run past its lease, and nothing else'
);

select is(
  (select status || ':' || (error ->> 'code') from public.generation_runs where id = '19030000-0000-4000-8000-0000000000e2'),
  'expired:LEASE_EXPIRED',
  'X1 the run is expired, with LEASE_EXPIRED recorded'
);

select is(
  (select status from public.generation_runs where id = '19030000-0000-4000-8000-0000000000a1'),
  'briefed',
  'X1 a run with no lease is left alone'
);

select lives_ok(
  $$ insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by, lease_expires_at)
     values ('19030000-0000-4000-8000-0000000000e3', current_setting('gr.team')::uuid,
             '19030000-0000-4000-8000-000000000001', 'episode', '19030000-0000-4000-8000-000000000011',
             'story', 'external', current_setting('gr.owner')::uuid, now() + interval '30 minutes') $$,
  'X1 after expiry, a new run on Ep 1 / story opens'
);

select is(
  (select count(*)::int from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'generation_runs'),
  1,
  'generation_runs is in the supabase_realtime publication'
);

-- ------------------------------------------------------------------
-- RLS: members read the team's runs, parts and revisions; nobody else
-- ------------------------------------------------------------------
select makerkit.authenticate_as('member');

select is(
  (select count(*)::int from public.generation_runs where project_id = '19030000-0000-4000-8000-000000000001'),
  7,
  'R1 a team member reads every run of the team'
);

select is(
  (select count(*)::int from public.generation_run_parts where run_id = '19030000-0000-4000-8000-0000000000e1'),
  1,
  'R1 a team member reads the parts of a team run'
);

select is(
  (select count(*)::int from public.content_revisions where id = '19030000-0000-4000-8000-0000000000c1'),
  1,
  'R1 a team member reads the team''s revisions'
);

select throws_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, created_by)
     values (current_setting('gr.team')::uuid, '19030000-0000-4000-8000-000000000001', 'episode',
             '19030000-0000-4000-8000-000000000012', 'audio_cues', 'external', tests.get_supabase_uid('member')) $$,
  '42501',
  'permission denied for table generation_runs',
  'R2 a signed-in user cannot insert a run directly: openRun and the service role write them'
);

select throws_ok(
  $$ update public.generation_runs set status = 'cancelled' where id = '19030000-0000-4000-8000-0000000000a1' $$,
  '42501',
  'permission denied for table generation_runs',
  'R2 nor update one'
);

select throws_ok(
  $$ insert into public.generation_run_parts (run_id, part_key, output)
     values ('19030000-0000-4000-8000-0000000000e3', 'story', '{}'::jsonb) $$,
  '42501',
  'permission denied for table generation_run_parts',
  'R2 nor submit a part directly'
);

select throws_ok(
  $$ insert into public.content_revisions (account_id, target_type, target_id, stage, snapshot)
     values (current_setting('gr.team')::uuid, 'episode', '19030000-0000-4000-8000-000000000012', 'story', '{}'::jsonb) $$,
  '42501',
  'permission denied for table content_revisions',
  'R2 nor write a revision'
);

select makerkit.authenticate_as('gr_out');

select is(
  (select count(*)::int from public.generation_runs),
  0,
  'R3 a stranger reads no runs'
);

select is(
  (select count(*)::int from public.generation_run_parts),
  0,
  'R3 a stranger reads no parts'
);

select is(
  (select count(*)::int from public.content_revisions),
  0,
  'R3 a stranger reads no revisions'
);

-- ------------------------------------------------------------------
-- account_ai_settings: owners write, members read
-- ------------------------------------------------------------------
select makerkit.authenticate_as('member');

select throws_ok(
  $$ insert into public.account_ai_settings (account_id, default_mode)
     values (current_setting('gr.team')::uuid, 'external') $$,
  '42501',
  'new row violates row-level security policy for table "account_ai_settings"',
  'S1 a member cannot create the team''s AI settings'
);

select makerkit.authenticate_as('owner');

select lives_ok(
  $$ insert into public.account_ai_settings (account_id, default_mode)
     values (current_setting('gr.team')::uuid, 'external') $$,
  'S1 an owner creates the team''s AI settings'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set external_generation_enabled = false
                       where account_id = current_setting('gr.team')::uuid $$),
  1,
  'S1 an owner updates them'
);

select makerkit.authenticate_as('member');

select is(
  (select default_mode from public.account_ai_settings where account_id = current_setting('gr.team')::uuid),
  'external',
  'S2 a member reads them'
);

select is(
  pg_temp.affected($$ update public.account_ai_settings set default_mode = 'server'
                       where account_id = current_setting('gr.team')::uuid $$),
  0,
  'S2 a member''s update changes nothing'
);

select makerkit.authenticate_as('gr_out');

select is(
  (select count(*)::int from public.account_ai_settings),
  0,
  'S3 a stranger reads no settings'
);

-- ------------------------------------------------------------------
-- restore_content_revision: gated on write permission, undoable
-- ------------------------------------------------------------------
set local role postgres;

insert into public.shots (id, episode_id, sequence_number, scene_number, shot_number, prompt)
values ('19030000-0000-4000-8000-0000000000b1', '19030000-0000-4000-8000-000000000011', 1, 1, 1, 'old prompt');

-- the snapshot a commit would have written before replacing Ep 1's story and shots
insert into public.content_revisions (id, account_id, target_type, target_id, stage, run_id, snapshot)
select '19030000-0000-4000-8000-0000000000c2', current_setting('gr.team')::uuid, 'episode',
       '19030000-0000-4000-8000-000000000011', 'story', null,
       jsonb_build_object(
         'episode', jsonb_build_object('story_data', '{"v": 1}'::jsonb),
         'shots', jsonb_build_array(to_jsonb(s))
       )
from public.shots s where s.id = '19030000-0000-4000-8000-0000000000b1';

-- ... and then the commit replaced them
update public.episodes set story_data = '{"v": 2}'::jsonb where id = '19030000-0000-4000-8000-000000000011';
update public.shots set prompt = 'new prompt' where id = '19030000-0000-4000-8000-0000000000b1';
select set_config('gr.version', (select version::text from public.episodes where id = '19030000-0000-4000-8000-000000000011'), true);

insert into public.content_revisions (id, account_id, target_type, target_id, stage, snapshot)
values ('19030000-0000-4000-8000-0000000000c3', current_setting('gr.team')::uuid, 'season',
        '19030000-0000-4000-8000-000000000001', 'season_outline', '{}'::jsonb);

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select public.restore_content_revision('19030000-0000-4000-8000-0000000000c2') $$,
  '42501',
  'refused: no write access to the project of revision 19030000-0000-4000-8000-0000000000c2',
  'V1 a member without project write access cannot restore'
);

select makerkit.authenticate_as('owner');

select set_config('gr.undo',
  public.restore_content_revision('19030000-0000-4000-8000-0000000000c2')::text, true);

set local role postgres;

select is(
  (select story_data from public.episodes where id = '19030000-0000-4000-8000-000000000011'),
  '{"v": 1}'::jsonb,
  'V2 the project owner restores the story'
);

select is(
  (select prompt from public.shots where id = '19030000-0000-4000-8000-0000000000b1'),
  'old prompt',
  'V2 and the shots the snapshot carried'
);

select ok(
  (select version from public.episodes where id = '19030000-0000-4000-8000-000000000011')
    > current_setting('gr.version')::integer,
  'V2 the restore bumps episodes.version, so an open run fails finalize with TARGET_CHANGED'
);

select is(
  (select snapshot from public.content_revisions where id = current_setting('gr.undo')::uuid),
  (select jsonb_build_object(
     'episode', jsonb_build_object('story_data', '{"v": 2}'::jsonb),
     'shots', jsonb_build_array(
       to_jsonb(s) || jsonb_build_object('prompt', 'new prompt', 'updated_at', s.updated_at)
     ))
   from public.shots s where s.id = '19030000-0000-4000-8000-0000000000b1'),
  'V3 the restore wrote what it replaced as a new revision, covering only the keys it touched'
);

select is(
  (select run_id is null and stage = 'story' and target_id = '19030000-0000-4000-8000-000000000011'
     from public.content_revisions where id = current_setting('gr.undo')::uuid),
  true,
  'V3 the undo revision has no run and the same stage and target'
);

select makerkit.authenticate_as('owner');

select throws_ok(
  $$ select public.restore_content_revision('19030000-0000-4000-8000-0000000000c3') $$,
  '0A000',
  'a season revision cannot be restored yet',
  'V4 a target type part A does not restore is refused, not silently skipped'
);

select throws_ok(
  $$ select public.restore_content_revision('19030000-0000-4000-8000-0000000000ff') $$,
  'P0002',
  'revision 19030000-0000-4000-8000-0000000000ff does not exist',
  'V4 an unknown revision is refused'
);

select * from finish();

rollback;
