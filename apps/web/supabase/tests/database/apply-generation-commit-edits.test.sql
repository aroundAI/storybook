begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(18);

-- FILM-1909: a targeted edit (edit_shot, edit_scene, edit_dialogue_line)
-- commits through apply_generation_commit under a run on the episode. The
-- allowlist lets it update a shot's and a dialogue line's content columns
-- in place, and nothing else: not the row's episode, place, status, media or
-- language, and not a row of another episode. The run's version check and
-- the content_revisions snapshot apply as to any stage commit.

select makerkit.set_identifier('owner', 'owner@storybook.dev');

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('ed.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19090000-0000-4000-8000-000000000001', current_setting('ed.team')::uuid, 'FILM-1909 edits P', 'active'),
  ('19090000-0000-4000-8000-000000000002', current_setting('ed.team')::uuid, 'FILM-1909 edits Q', 'active');

insert into public.episodes (id, project_id, number, title) values
  ('19090000-0000-4000-8000-000000000011', '19090000-0000-4000-8000-000000000001', 1, 'Edited'),
  ('19090000-0000-4000-8000-000000000012', '19090000-0000-4000-8000-000000000001', 2, 'Sibling'),
  ('19090000-0000-4000-8000-000000000021', '19090000-0000-4000-8000-000000000002', 1, 'Elsewhere');

insert into public.shots (id, episode_id, scene_number, shot_number, sequence_number, prompt, duration_seconds, status, video_url) values
  ('19090000-0000-4000-8000-000000000031', '19090000-0000-4000-8000-000000000011', 1, 1, 1, 'the old prompt', 5, 'completed', 'https://video/1.mp4'),
  ('19090000-0000-4000-8000-000000000032', '19090000-0000-4000-8000-000000000012', 1, 1, 1, 'sibling shot', 5, 'pending', null);

insert into public.dialogue_lines (id, episode_id, scene_number, sequence_number, text, language, status, audio_url) values
  ('19090000-0000-4000-8000-000000000041', '19090000-0000-4000-8000-000000000011', 1, 1, 'Not again.', 'en', 'completed', 'https://audio/1.mp3'),
  ('19090000-0000-4000-8000-000000000042', '19090000-0000-4000-8000-000000000012', 1, 1, 'Sibling line.', 'en', 'pending', null);

create function pg_temp.open_edit_run(p_stage text)
returns uuid language sql as $$
  select (public.open_generation_run(
    p_account_id := current_setting('ed.team')::uuid,
    p_project_id := '19090000-0000-4000-8000-000000000001',
    p_target_type := 'episode', p_target_id := '19090000-0000-4000-8000-000000000011',
    p_stage := p_stage, p_mode := 'external',
    p_input := '{"kind": "stage", "target": {}}'::jsonb,
    p_origin := '{"kind": "mcp", "name": "edit"}'::jsonb,
    p_target_version := (select version from public.episodes where id = '19090000-0000-4000-8000-000000000011')
  ) -> 'run' ->> 'id')::uuid
$$;
grant execute on function pg_temp.open_edit_run(text) to authenticated;

select makerkit.authenticate_as('owner');

-- ------------------------------------------------------------------
-- E1: a shot's content columns, updated in place
-- ------------------------------------------------------------------
select set_config('ed.shots', pg_temp.open_edit_run('shots')::text, true);

select is(
  public.apply_generation_commit(current_setting('ed.shots')::uuid, $p$ {"ops": [
    {"op": "update", "table": "shots", "requireRows": true,
     "values": {"prompt": "the new prompt", "duration_seconds": 7,
                "first_frame_description": "a door", "generation_origin": {"kind": "external"}},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000031"},
               {"column": "episode_id", "op": "eq", "value": "19090000-0000-4000-8000-000000000011"}]},
    {"op": "update", "table": "episodes", "requireRows": true,
     "values": {"updated_at": "2026-10-03T12:00:00Z"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000011"}]}
  ]} $p$::jsonb) ->> 'ok',
  'true',
  'E1 a shot edit applies'
);

select results_eq(
  $$ select id, prompt, duration_seconds, first_frame_description, sequence_number, status::text, video_url
     from public.shots where id = '19090000-0000-4000-8000-000000000031' $$,
  $$ values ('19090000-0000-4000-8000-000000000031'::uuid, 'the new prompt', 7, 'a door', 1, 'completed', 'https://video/1.mp4') $$,
  'E1 the shot keeps its id, place, status and video; its content changes'
);

select is(
  (select snapshot -> 'shots' -> 0 ->> 'prompt' from public.content_revisions
    where run_id = current_setting('ed.shots')::uuid),
  'the old prompt',
  'E1 the replaced shot is snapshotted for restore'
);

select is(
  (select status from public.generation_runs where id = current_setting('ed.shots')::uuid),
  'committed',
  'E1 the edit run is committed in the same call'
);

-- ------------------------------------------------------------------
-- E2: what an edit may not touch on a shot
-- ------------------------------------------------------------------
select set_config('ed.shots2', pg_temp.open_edit_run('shots')::text, true);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "shots", "values": {"video_url": "https://elsewhere/x.mp4"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000031"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.shots2')),
  '42501', 'refused: video_url is not a column a generation commit updates in shots',
  'E2 a shot''s rendered media is not an edit'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "shots", "values": {"episode_id": "19090000-0000-4000-8000-000000000012"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000031"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.shots2')),
  '42501', 'refused: episode_id is not a column a generation commit updates in shots',
  'E2 a shot cannot be moved to another episode'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "shots", "values": {"sequence_number": 9, "status": "pending"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000031"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.shots2')),
  '42501', null,
  'E2 a shot''s place and status are not an edit'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "shots", "values": {"prompt": "hijacked"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000032"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.shots2')),
  '42501', 'refused: 1 shots row(s) are outside the run''s episode',
  'E2 a shot of another episode of the project is outside the edit''s episode'
);

select is(
  (select prompt from public.shots where id = '19090000-0000-4000-8000-000000000032'),
  'sibling shot',
  'E2 and the refused write rolled back'
);

-- ------------------------------------------------------------------
-- E3: a dialogue line's text and speaker, in place
-- ------------------------------------------------------------------
select set_config('ed.lines', pg_temp.open_edit_run('screenplay_refinement')::text, true);

select is(
  public.apply_generation_commit(current_setting('ed.lines')::uuid, $p$ {"ops": [
    {"op": "update", "table": "dialogue_lines", "requireRows": true,
     "values": {"text": "Not AGAIN.", "status": "pending", "generation_origin": {"kind": "external"}},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000041"}]}
  ]} $p$::jsonb) ->> 'ok',
  'true',
  'E3 a line edit applies'
);

select results_eq(
  $$ select text, status::text, sequence_number, language::text, audio_url
     from public.dialogue_lines where id = '19090000-0000-4000-8000-000000000041' $$,
  $$ values ('Not AGAIN.', 'pending', 1, 'en', 'https://audio/1.mp3') $$,
  'E3 the line keeps its place, language and audio; its text changes and it awaits a new render'
);

select is(
  (select snapshot -> 'dialogue_lines' -> 0 ->> 'text' from public.content_revisions
    where run_id = current_setting('ed.lines')::uuid),
  'Not again.',
  'E3 the replaced line is snapshotted for restore'
);

select set_config('ed.lines2', pg_temp.open_edit_run('screenplay_refinement')::text, true);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "dialogue_lines", "values": {"audio_url": "https://elsewhere/a.mp3"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000041"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.lines2')),
  '42501', 'refused: audio_url is not a column a generation commit updates in dialogue_lines',
  'E3 a line''s audio is not an edit'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "dialogue_lines", "values": {"language": "es", "sequence_number": 7},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000041"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.lines2')),
  '42501', null,
  'E3 a line''s language and place are not an edit'
);

select throws_ok(
  format($q$ select public.apply_generation_commit(%L, $p$ {"ops": [
    {"op": "update", "table": "dialogue_lines", "values": {"text": "hijacked"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000042"}]}
  ]} $p$::jsonb) $q$, current_setting('ed.lines2')),
  '42501', 'refused: 1 dialogue_lines row(s) are outside the run''s episode',
  'E3 a line of another episode is outside the edit''s episode'
);

-- ------------------------------------------------------------------
-- E4: an edit at a stale version writes nothing
-- ------------------------------------------------------------------
-- E2's run, still open (its writes were refused), was briefed at the
-- episode's version after E1; the web moves the episode now

update public.episodes set title = 'Edited on the web' where id = '19090000-0000-4000-8000-000000000011';

select is(
  public.apply_generation_commit(current_setting('ed.shots2')::uuid, $p$ {"ops": [
    {"op": "update", "table": "shots", "values": {"prompt": "late"},
     "match": [{"column": "id", "op": "eq", "value": "19090000-0000-4000-8000-000000000031"}]}
  ]} $p$::jsonb) ->> 'code',
  'TARGET_CHANGED',
  'E4 an edit briefed before the episode moved is TARGET_CHANGED'
);

select is(
  (select prompt from public.shots where id = '19090000-0000-4000-8000-000000000031'),
  'the new prompt',
  'E4 and the shot is untouched'
);

-- ------------------------------------------------------------------
-- E5: the rest of the allowlist is unchanged
-- ------------------------------------------------------------------
set local role postgres;

select is(
  kit.generation_commit_allowlist() -> 'audio_cues' -> 'update',
  '[]'::jsonb,
  'E5 audio cues still take no update'
);

select * from finish();

rollback;
