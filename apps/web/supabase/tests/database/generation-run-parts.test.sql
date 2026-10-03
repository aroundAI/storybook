begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(24);

-- FILM-1908: submit_generation_run_part, the only way a part an external
-- agent wrote reaches generation_run_parts. authenticated has no write
-- privilege on the table (FILM-1903 part A), so every rule here is the
-- function's, exercised with real roles.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner   creates project P and opens the runs
--   member  added to P as a project member: writes P, but did not open the runs
--   rp_out  a stranger

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('rp_out', 'rp-out@storybook.dev');

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('rp.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19081000-0000-4000-8000-000000000001', current_setting('rp.team')::uuid, 'FILM-1908 parts', 'active');

insert into public.project_members (project_id, user_id, role) values
  ('19081000-0000-4000-8000-000000000001', tests.get_supabase_uid('member'), 'member')
on conflict do nothing;

insert into public.episodes (id, project_id, number, title) values
  ('19081000-0000-4000-8000-000000000011', '19081000-0000-4000-8000-000000000001', 1, 'Ep 1'),
  ('19081000-0000-4000-8000-000000000012', '19081000-0000-4000-8000-000000000001', 2, 'Ep 2');

-- an external run (story on Ep 1) and a server run (story on Ep 2)
select makerkit.authenticate_as('owner');

select set_config('rp.ext', public.open_generation_run(
  p_account_id := current_setting('rp.team')::uuid,
  p_project_id := '19081000-0000-4000-8000-000000000001',
  p_target_type := 'episode', p_target_id := '19081000-0000-4000-8000-000000000011',
  p_stage := 'story', p_mode := 'external',
  p_input := '{"kind": "stage", "target": {}}'::jsonb,
  p_origin := '{"kind": "mcp", "name": "start_generation", "clientName": "Claude"}'::jsonb
) -> 'run' ->> 'id', true);

select set_config('rp.srv', public.open_generation_run(
  p_account_id := current_setting('rp.team')::uuid,
  p_project_id := '19081000-0000-4000-8000-000000000001',
  p_target_type := 'episode', p_target_id := '19081000-0000-4000-8000-000000000012',
  p_stage := 'story', p_mode := 'server',
  p_input := '{}'::jsonb,
  p_origin := '{"kind": "web", "name": "episodes.generateStory"}'::jsonb
) -> 'run' ->> 'id', true);

-- ------------------------------------------------------------------
-- The table stays closed to direct writes
-- ------------------------------------------------------------------
select throws_ok(
  $$ insert into public.generation_run_parts (run_id, part_key, output)
     values (current_setting('rp.ext')::uuid, 'story', '{}'::jsonb) $$,
  '42501', null,
  'P0 authenticated cannot insert a part directly'
);

-- ------------------------------------------------------------------
-- A rejected submission is recorded, with no accepted output
-- ------------------------------------------------------------------
select is(
  (public.submit_generation_run_part(
    current_setting('rp.ext')::uuid, 'story', '{"story": {}}'::jsonb,
    '{"hash": "h0", "errors": [{"path": "story.fullText", "code": "invalid_type", "message": "Required"}]}'::jsonb,
    false
  ) ->> 'ok')::boolean, true,
  'P1 the opener submits a rejected part'
);

select is(
  (select validation ->> 'status' from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  'rejected',
  'P1 a part with only a rejection is marked rejected'
);

select is(
  (select validation -> 'failures' -> 0 -> 'errors' -> 0 ->> 'path' from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  'story.fullText',
  'P1 the failure keeps the field path'
);

select is(
  (select status from public.generation_runs where id = current_setting('rp.ext')::uuid),
  'in_progress',
  'P1 a submission moves a briefed run to in_progress'
);

-- ------------------------------------------------------------------
-- An accepted submission replaces the output and keeps the failures
-- ------------------------------------------------------------------
select is(
  (public.submit_generation_run_part(
    current_setting('rp.ext')::uuid, 'story', '{"story": {"fullText": "one"}}'::jsonb,
    '{"hash": "h1", "model": "claude-x", "result": {"status": "accepted"}}'::jsonb,
    true, 'claude-x'
  ) ->> 'ok')::boolean, true,
  'P2 the opener submits an accepted part'
);

select is(
  (select output from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  '{"story": {"fullText": "one"}}'::jsonb,
  'P2 the accepted output is stored'
);

select is(
  (select validation ->> 'status' || ':' || (validation ->> 'hash') || ':' || jsonb_array_length(validation -> 'failures')
   from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  'accepted:h1:1',
  'P2 the part is accepted, carries its hash and keeps the earlier failure'
);

select is(
  (select origin ->> 'model' || '/' || (origin ->> 'modelReportedBy') || '/' || (origin ->> 'clientName')
   from public.generation_runs where id = current_setting('rp.ext')::uuid),
  'claude-x/client/Claude',
  'P2 the reported model joins the run origin, marked as reported by the client'
);

-- a later rejection never replaces the accepted output
select is(
  (public.submit_generation_run_part(
    current_setting('rp.ext')::uuid, 'story', '{"story": {"bad": true}}'::jsonb,
    '{"hash": "h2", "errors": [{"path": "story.title", "code": "too_small", "message": "short"}]}'::jsonb,
    false
  ) ->> 'ok')::boolean, true,
  'P3 a rejected resubmission is recorded'
);

select is(
  (select output || jsonb_build_object('s', validation ->> 'status', 'n', jsonb_array_length(validation -> 'failures'))
   from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  '{"story": {"fullText": "one"}, "s": "accepted", "n": 2}'::jsonb,
  'P3 the accepted output stays; the rejection is appended to the failures'
);

-- an accepted resubmission replaces it
select public.submit_generation_run_part(
  current_setting('rp.ext')::uuid, 'story', '{"story": {"fullText": "two"}}'::jsonb,
  '{"hash": "h3"}'::jsonb, true
);

select is(
  (select output from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  '{"story": {"fullText": "two"}}'::jsonb,
  'P4 an accepted resubmission replaces the part'
);

select is(
  (select count(*)::int from public.generation_run_parts where run_id = current_setting('rp.ext')::uuid),
  1,
  'P4 one row per part'
);

-- the failures are capped at the newest 20
select public.submit_generation_run_part(
  current_setting('rp.ext')::uuid, 'story', '{}'::jsonb,
  jsonb_build_object('hash', 'r' || g, 'errors', '[]'::jsonb), false
) from generate_series(1, 25) g;

select is(
  (select jsonb_array_length(validation -> 'failures') || ':' || (validation -> 'failures' -> 19 ->> 'hash')
   from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  '20:r25',
  'P5 the newest 20 failures are kept, oldest first'
);

-- ------------------------------------------------------------------
-- Who may submit, and to what
-- ------------------------------------------------------------------
select throws_ok(
  $$ select public.submit_generation_run_part(
       current_setting('rp.srv')::uuid, 'story', '{}'::jsonb, '{}'::jsonb, true) $$,
  '23514', null,
  'P6 a server run takes no submitted part'
);

select throws_ok(
  $$ select public.submit_generation_run_part(
       current_setting('rp.ext')::uuid, repeat('k', 101), '{}'::jsonb, '{}'::jsonb, true) $$,
  '23514', null,
  'P7 a part key is at most 100 characters'
);

select throws_ok(
  $$ select public.submit_generation_run_part(
       current_setting('rp.ext')::uuid, 'big',
       jsonb_build_object('t', repeat('x', 270000)), '{}'::jsonb, true) $$,
  '23514', null,
  'P8 a part over 256 KB is refused'
);

select is(
  public.submit_generation_run_part(
    '19081000-0000-4000-8000-0000000000ff', 'story', '{}'::jsonb, '{}'::jsonb, true
  ) ->> 'code',
  'RUN_NOT_FOUND',
  'P9 an unknown run is RUN_NOT_FOUND'
);

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select public.submit_generation_run_part(
       current_setting('rp.ext')::uuid, 'story', '{}'::jsonb, '{}'::jsonb, true) $$,
  '42501', null,
  'P10 a project writer who did not open the run cannot submit to it'
);

select is(
  (select count(*)::int from public.generation_run_parts where run_id = current_setting('rp.ext')::uuid),
  1,
  'P10 a team member reads the run''s parts'
);

select tests.authenticate_as('rp_out');

select throws_ok(
  $$ select public.submit_generation_run_part(
       current_setting('rp.ext')::uuid, 'story', '{}'::jsonb, '{}'::jsonb, true) $$,
  '42501', null,
  'P11 a stranger cannot submit'
);

select is(
  (select count(*)::int from public.generation_run_parts where run_id = current_setting('rp.ext')::uuid),
  0,
  'P11 a stranger reads no parts'
);

-- ------------------------------------------------------------------
-- A closed run takes nothing
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');

select public.transition_generation_run(current_setting('rp.ext')::uuid, 'committed');

select is(
  public.submit_generation_run_part(
    current_setting('rp.ext')::uuid, 'story', '{"late": true}'::jsonb, '{}'::jsonb, true
  ) ->> 'code',
  'RUN_NOT_OPEN',
  'P12 a committed run refuses a part as RUN_NOT_OPEN'
);

select is(
  (select output from public.generation_run_parts
   where run_id = current_setting('rp.ext')::uuid and part_key = 'story'),
  '{"story": {"fullText": "two"}}'::jsonb,
  'P12 and its stored part is unchanged'
);

select * from finish();
rollback;
