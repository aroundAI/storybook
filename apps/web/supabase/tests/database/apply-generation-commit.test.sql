begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(45);

-- FILM-1901 criterion 4, FILM-1903: a stage's commit applies in one
-- transaction. apply_generation_commit(run, plan) takes the ordered writes a
-- commit computed, checks the run (open, the caller may drive it, the
-- episode unchanged since the brief), snapshots what the writes replace into
-- content_revisions, applies every write against an allowlist of tables and
-- columns scoped to the run's project, and moves the run to committed. Any
-- failure rolls all of it back. Each property is exercised here, not read.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner   creates projects P and Q -> project owner of both (writes)
--   member  account member, not on project_members -> reads P, drives nothing
--   ac_out  a stranger -> nothing

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('ac_out', 'ac-out@storybook.dev');

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('ac.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19033000-0000-4000-8000-000000000001', current_setting('ac.team')::uuid, 'FILM-1903 commit P', 'active'),
  ('19033000-0000-4000-8000-000000000002', current_setting('ac.team')::uuid, 'FILM-1903 commit Q', 'active');

insert into public.episodes (id, project_id, number, title, story_data, metadata) values
  ('19033000-0000-4000-8000-000000000011', '19033000-0000-4000-8000-000000000001', 1, 'Ep 1', '{"v": 1}'::jsonb, '{"keep": true}'::jsonb),
  ('19033000-0000-4000-8000-000000000021', '19033000-0000-4000-8000-000000000002', 1, 'Q Ep 1', '{"q": 1}'::jsonb, '{}'::jsonb);

insert into public.shots (id, episode_id, sequence_number, prompt, duration_seconds) values
  ('19033000-0000-4000-8000-000000000031', '19033000-0000-4000-8000-000000000011', 1, 'the old shot', 5),
  ('19033000-0000-4000-8000-000000000032', '19033000-0000-4000-8000-000000000021', 1, 'Q''s shot', 5);

-- One run per stage on episode 1, opened by the owner
create function pg_temp.open_run(p_stage text, p_version integer default null)
returns uuid language sql as $$
  select (public.open_generation_run(
    p_account_id := current_setting('ac.team')::uuid,
    p_project_id := '19033000-0000-4000-8000-000000000001',
    p_target_type := 'episode', p_target_id := '19033000-0000-4000-8000-000000000011',
    p_stage := p_stage, p_mode := 'server',
    p_input := '{}'::jsonb, p_origin := '{}'::jsonb,
    p_target_version := p_version
  ) -> 'run' ->> 'id')::uuid
$$;
grant execute on function pg_temp.open_run(text, integer) to authenticated;

select makerkit.authenticate_as('owner');
select set_config('ac.shots', pg_temp.open_run('shots')::text, true);
select set_config('ac.story', pg_temp.open_run('story')::text, true);
select set_config('ac.audio', pg_temp.open_run('audio_cues')::text, true);

-- ------------------------------------------------------------------
-- A1: a plan whose third write fails leaves the first two unapplied
-- ------------------------------------------------------------------
select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"shot_list": {"n": 2}},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]},
    {"op": "delete", "table": "shots",
     "match": [{"column": "episode_id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]},
    {"op": "insert", "table": "shots", "rows": [
      {"episode_id": "19033000-0000-4000-8000-000000000011", "sequence_number": 1, "prompt": "new", "duration_seconds": 0}]}
  ]} $p$::jsonb) $q$, current_setting('ac.shots')),
  '23514', null,
  'A1 the third write breaks a CHECK and the call fails'
);

select is(
  (select shot_list from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  null,
  'A1 the first write (shot_list) is rolled back'
);

select is(
  (select array_agg(prompt) from public.shots where episode_id = '19033000-0000-4000-8000-000000000011'),
  array['the old shot']::text[],
  'A1 the second write (clearing the shots) is rolled back'
);

select is(
  (select status from public.generation_runs where id = current_setting('ac.shots')::uuid),
  'briefed',
  'A1 the run is still open'
);

select is(
  (select count(*)::integer from public.content_revisions where run_id = current_setting('ac.shots')::uuid),
  0,
  'A1 no revision survives the failed commit'
);

-- ------------------------------------------------------------------
-- A2: the same commit, valid: applied, snapshotted and committed together
-- ------------------------------------------------------------------
select set_config('ac.a2', public.apply_generation_commit(current_setting('ac.shots')::uuid, $p$ {"ops": [
  {"op": "update", "table": "episodes", "values": {"shot_list": {"n": 2}},
   "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"},
             {"column": "deleted_at", "op": "is", "value": null}],
   "requireRows": true},
  {"op": "delete", "table": "shots",
   "match": [{"column": "episode_id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]},
  {"key": "shots", "op": "insert", "table": "shots", "returning": ["sequence_number"], "rows": [
    {"episode_id": "19033000-0000-4000-8000-000000000011", "sequence_number": 1, "prompt": "new 1", "duration_seconds": 4},
    {"episode_id": "19033000-0000-4000-8000-000000000011", "sequence_number": 2, "prompt": "new 2", "duration_seconds": 6}]}
]} $p$::jsonb)::text, true);

select is(current_setting('ac.a2')::jsonb ->> 'ok', 'true', 'A2 the commit applies');

select is(
  (select array_agg(prompt order by sequence_number) from public.shots where episode_id = '19033000-0000-4000-8000-000000000011'),
  array['new 1', 'new 2']::text[],
  'A2 the shots are replaced'
);

select is(
  (select shot_list from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  '{"n": 2}'::jsonb,
  'A2 the episode column is written'
);

select is(
  current_setting('ac.a2')::jsonb -> 'results' -> 'shots',
  '[{"sequence_number": 1}, {"sequence_number": 2}]'::jsonb,
  'A2 a keyed write returns the columns it asked for, in insert order'
);

select is(
  (select status from public.generation_runs where id = current_setting('ac.shots')::uuid),
  'committed',
  'A2 the run is committed in the same call'
);

select is(
  (select snapshot -> 'episode' from public.content_revisions where run_id = current_setting('ac.shots')::uuid),
  '{"shot_list": null}'::jsonb,
  'A2 the revision holds the episode column as it was before'
);

select is(
  (select jsonb_path_query_array(snapshot, '$.shots[*].prompt') from public.content_revisions where run_id = current_setting('ac.shots')::uuid),
  '["the old shot"]'::jsonb,
  'A2 the revision holds the replaced shots'
);

select is(
  (select stage || ':' || target_type from public.content_revisions where run_id = current_setting('ac.shots')::uuid),
  'shots:episode',
  'A2 the revision is filed under the run''s stage and target'
);

select is(
  current_setting('ac.a2')::jsonb ->> 'revision_id',
  (select id::text from public.content_revisions where run_id = current_setting('ac.shots')::uuid),
  'A2 the result names the revision'
);

-- ------------------------------------------------------------------
-- A3: a closed run commits nothing
-- ------------------------------------------------------------------
select is(
  public.apply_generation_commit(current_setting('ac.shots')::uuid, '{"ops": []}'::jsonb) ->> 'code',
  'RUN_NOT_OPEN',
  'A3 a committed run cannot commit again'
);

-- ------------------------------------------------------------------
-- A4: the allowlist
-- ------------------------------------------------------------------
select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"story_data": {"v": 9}},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]},
    {"op": "update", "table": "accounts", "values": {"name": "taken"},
     "match": [{"column": "id", "op": "eq", "value": "%s"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story'), current_setting('ac.team')),
  '42501', 'refused: accounts is not a table a generation commit writes',
  'A4 a table off the allowlist is refused'
);

select is(
  (select story_data from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  '{"v": 1}'::jsonb,
  'A4 and nothing before it is applied'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"visibility": "public"},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', 'refused: visibility is not a column a generation commit updates in episodes',
  'A4 a column off the allowlist is refused'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"project_id": "19033000-0000-4000-8000-000000000002"},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', 'refused: project_id is not a column a generation commit updates in episodes',
  'A4 a row cannot be moved to another project'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "delete", "table": "episodes",
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', 'refused: a generation commit does not delete episodes',
  'A4 an operation the table does not allow is refused'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "delete", "table": "shots", "match": []}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', 'refused: a delete on shots needs a filter',
  'A4 an unfiltered delete is refused'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "group", "onError": "skip", "ops": [
      {"op": "update", "table": "generation_runs", "values": {"status": "committed"},
       "match": [{"column": "id", "op": "eq", "value": "%s"}]}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story'), current_setting('ac.story')),
  '42501', 'refused: generation_runs is not a table a generation commit writes',
  'A4 a refused table inside a skippable group still refuses the whole plan'
);

-- ------------------------------------------------------------------
-- A5: the run's project scopes every write
-- ------------------------------------------------------------------
select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"story_data": {"stolen": true}},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000021"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', null,
  'A5 an update on another project''s episode is refused'
);

select is(
  (select story_data from public.episodes where id = '19033000-0000-4000-8000-000000000021'),
  '{"q": 1}'::jsonb,
  'A5 and the other project''s episode is untouched'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "delete", "table": "shots",
     "match": [{"column": "episode_id", "op": "eq", "value": "19033000-0000-4000-8000-000000000021"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', null,
  'A5 a delete of another project''s shots is refused'
);

select is(
  (select count(*)::integer from public.shots where episode_id = '19033000-0000-4000-8000-000000000021'),
  1,
  'A5 and the other project''s shot is still there'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "upsert", "table": "assets", "onConflict": "project_id,type,name", "ignoreDuplicates": true, "rows": [
      {"project_id": "19033000-0000-4000-8000-000000000002", "type": "character", "name": "Planted"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', null,
  'A5 an asset in another project is refused'
);

-- ------------------------------------------------------------------
-- A6: only a caller who may drive the run commits it
-- ------------------------------------------------------------------
select makerkit.authenticate_as('member');

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"story_data": {"by": "member"}},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) $q$, current_setting('ac.story')),
  '42501', null,
  'A6 a member without write access to the project is refused'
);

select makerkit.authenticate_as('ac_out');

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, '{"ops": []}'::jsonb) $q$, current_setting('ac.story')),
  '42501', null,
  'A6 a stranger is refused'
);

select makerkit.authenticate_as('owner');

select is(
  (select story_data from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  '{"v": 1}'::jsonb,
  'A6 the refused callers wrote nothing'
);

-- ------------------------------------------------------------------
-- A7: TARGET_CHANGED — the episode moved since the brief
-- ------------------------------------------------------------------
select set_config('ac.ideation', pg_temp.open_run(
  'ideation',
  (select version from public.episodes where id = '19033000-0000-4000-8000-000000000011')
)::text, true);

set local role postgres;
update public.episodes set title = 'Edited on the web' where id = '19033000-0000-4000-8000-000000000011';
select makerkit.authenticate_as('owner');

select is(
  public.apply_generation_commit(current_setting('ac.ideation')::uuid, $p$ {"ops": [
    {"op": "update", "table": "episodes", "values": {"metadata": {"ideas": []}},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) ->> 'code',
  'TARGET_CHANGED',
  'A7 a commit on an episode edited since the brief is TARGET_CHANGED'
);

select is(
  (select metadata from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  '{"keep": true}'::jsonb,
  'A7 and writes nothing'
);

select is(
  (select status from public.generation_runs where id = current_setting('ac.ideation')::uuid),
  'briefed',
  'A7 the run stays open for the caller to fail or retry'
);

-- ------------------------------------------------------------------
-- A8: a skippable group fails alone; references; jsonb merge
-- ------------------------------------------------------------------
select set_config('ac.a8', public.apply_generation_commit(current_setting('ac.story')::uuid, $p$ {"ops": [
  {"op": "update", "table": "episodes", "values": {"story_data": {"v": 2}},
   "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]},
  {"key": "canon", "op": "group", "onError": "skip", "ops": [
    {"op": "update", "table": "episodes", "values": {"metadata": {"themes": ["loss"]}}, "merge": ["metadata"],
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]},
    {"op": "update", "table": "narrative_threads", "values": {"status": "resolved"}, "requireRows": true,
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-0000000000ff"}]}]},
  {"key": "chars", "op": "upsert", "table": "assets", "onConflict": "project_id,type,name",
   "ignoreDuplicates": true, "returning": ["id"], "rows": [
     {"project_id": "19033000-0000-4000-8000-000000000001", "type": "character", "name": "Ada"}]},
  {"op": "update", "table": "episodes", "merge": ["metadata"], "onlyIfRows": ["chars"],
   "values": {"metadata": {"character_ids": {"$union": [["kept-id"], {"$ref": "chars", "column": "id"}]}}},
   "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
]} $p$::jsonb)::text, true);

select is(current_setting('ac.a8')::jsonb ->> 'ok', 'true', 'A8 the commit applies around the failed group');

select is(
  (select story_data from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  '{"v": 2}'::jsonb,
  'A8 the writes outside the group are applied'
);

select is(
  (select metadata - 'character_ids' from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  '{"keep": true}'::jsonb,
  'A8 the group''s first write is rolled back with the one that failed, and merge keeps the other keys'
);

select is(
  (select metadata -> 'character_ids' from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  jsonb_build_array('kept-id', (select id from public.assets where project_id = '19033000-0000-4000-8000-000000000001' and name = 'Ada')),
  'A8 a later write uses the id an earlier insert returned'
);

select is(
  current_setting('ac.a8')::jsonb -> 'skipped' -> 0 ->> 'key',
  'canon',
  'A8 the result names the skipped group'
);

select is(
  (select status from public.generation_runs where id = current_setting('ac.story')::uuid),
  'committed',
  'A8 the run is committed'
);

-- an upsert that inserts nothing leaves the dependent write out
select set_config('ac.again', pg_temp.open_run('story')::text, true);

select is(
  public.apply_generation_commit(current_setting('ac.again')::uuid, $p$ {"ops": [
    {"key": "chars", "op": "upsert", "table": "assets", "onConflict": "project_id,type,name",
     "ignoreDuplicates": true, "returning": ["id"], "rows": [
       {"project_id": "19033000-0000-4000-8000-000000000001", "type": "character", "name": "Ada"}]},
    {"op": "update", "table": "episodes", "merge": ["metadata"], "onlyIfRows": ["chars"],
     "values": {"metadata": {"character_ids": []}},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) -> 'results' -> 'chars',
  '[]'::jsonb,
  'A8 a duplicate is not inserted again'
);

select is(
  (select jsonb_array_length(metadata -> 'character_ids') from public.episodes where id = '19033000-0000-4000-8000-000000000011'),
  2,
  'A8 and the write that waited on it is left out'
);

-- ------------------------------------------------------------------
-- A9: a run that commits more than once (one job, several commits)
-- ------------------------------------------------------------------
select is(
  public.apply_generation_commit(current_setting('ac.audio')::uuid, '{"ops": []}'::jsonb, p_finalize := false) -> 'run' ->> 'status',
  'briefed',
  'A9 p_finalize := false applies and leaves the run open'
);

-- ------------------------------------------------------------------
-- A11: a regenerated story updates its world state by id, setting only
-- what changed (the planner once sent project_id and episode_id too, which
-- the allowlist refuses: every second story generation was rolled back)
-- ------------------------------------------------------------------
set local role postgres;
insert into public.world_states (id, project_id, episode_id, location) values
  ('19033000-0000-4000-8000-000000000041', '19033000-0000-4000-8000-000000000001', '19033000-0000-4000-8000-000000000011', 'The old gate');
select makerkit.authenticate_as('owner');
select set_config('ac.memory', pg_temp.open_run('story')::text, true);

select is(
  public.apply_generation_commit(current_setting('ac.memory')::uuid, $p$ {"ops": [
    {"key": "memory.world", "op": "update", "table": "world_states", "requireRows": true, "returning": ["id"],
     "values": {"location": "The north gate", "time_period": null, "atmosphere": "smoke", "active_conflicts": [], "updated_at": "2026-10-03T12:00:00Z"},
     "match": [{"column": "id", "op": "eq", "value": "19033000-0000-4000-8000-000000000041"}]},
    {"op": "insert", "table": "state_deltas", "onlyIfRows": ["memory.world"], "rows": [
      {"episode_id": "19033000-0000-4000-8000-000000000011", "entity_type": "world",
       "entity_id": {"$ref": "memory.world", "column": "id", "one": true},
       "before_state": {"location": "The old gate"}, "after_state": {"location": "The north gate"},
       "change_reason": "World state replaced"}]}
  ]} $p$::jsonb) ->> 'ok',
  'true',
  'A11 the world-state update by id applies'
);

select is(
  (select location || ' / ' || (select count(*) from public.state_deltas d where d.entity_id = w.id)::text
   from public.world_states w where w.id = '19033000-0000-4000-8000-000000000041'),
  'The north gate / 1',
  'A11 the row is updated and its delta names it'
);

-- ------------------------------------------------------------------
-- A10: the worker (service role) passes the gate
-- ------------------------------------------------------------------
select tests.authenticate_as_service_role();

select is(
  public.apply_generation_commit(current_setting('ac.audio')::uuid, $p$ {"ops": [
    {"op": "insert", "table": "audio_cues", "rows": [
      {"episode_id": "19033000-0000-4000-8000-000000000011", "cue_type": "music", "prompt": "a hum",
       "start_offset_seconds": 0, "duration_seconds": 3, "is_loopable": false, "status": "pending"}]}
  ]} $p$::jsonb) -> 'run' ->> 'status',
  'committed',
  'A10 the service role commits a worker run'
);

select * from finish();
rollback;
