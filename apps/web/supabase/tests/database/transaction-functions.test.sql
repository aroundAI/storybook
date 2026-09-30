begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(29);

-- FILM-103 (transaction functions). What each one guarantees and who may call
-- it: optimistic locking on update_episode_with_lock, replace-all on
-- batch_create_shots, the grouping and date window of
-- get_project_generation_costs, and the project-membership check every one of
-- them does before it touches a row (they are SECURITY DEFINER, so RLS
-- does not).
--
-- Fixture ids start with 1033.

select tests.create_supabase_user('fn_owner', 'fn-owner@storybook.dev');
select tests.create_supabase_user('fn_stranger', 'fn-stranger@storybook.dev');

-- The creator trigger on `projects` reads auth.uid() and makes the caller the
-- project's owner, so the owner creates the project.
select makerkit.authenticate_as('fn_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('10330000-0000-4000-8000-00000000000a', 'FILM-103 team', false, tests.get_supabase_uid('fn_owner'));

select makerkit.authenticate_as('fn_owner');
insert into public.projects (id, account_id, name, status) values
  ('10330000-0000-4000-8000-000000000001', '10330000-0000-4000-8000-00000000000a', 'FILM-103', 'active');

set local role postgres;
insert into public.episodes (id, project_id, number, title) values
  ('10330000-0000-4000-8000-000000000011', '10330000-0000-4000-8000-000000000001', 1, 'Original');

-- ---------------------------------------------------------------------------
-- create_character_with_details
-- ---------------------------------------------------------------------------
select makerkit.authenticate_as('fn_owner');

select throws_like(
  $$ select public.create_character_with_details(
       '10330000-0000-4000-8000-000000000001', null, 'd', '{}'::jsonb, 'p', 'e', array['u']) $$,
  'Failed to create character: null value in column "name"%',
  'a character with no name is refused'
);

select makerkit.authenticate_as('fn_stranger');

select throws_like(
  $$ select public.create_character_with_details(
       '10330000-0000-4000-8000-000000000001', 'Ada', 'd', '{}'::jsonb, 'p', 'e', array['u']) $$,
  '%Access denied: insufficient project permissions',
  'someone outside the project cannot create a character in it'
);

select makerkit.authenticate_as('fn_owner');

select lives_ok(
  $$ select public.create_character_with_details(
       '10330000-0000-4000-8000-000000000001', 'Mara', 'd', '{"age": 30}'::jsonb, 'p', 'e', array['u'], 'voice-abc') $$,
  'a member can create a character with its details (KB-140: it failed on every call)'
);

select results_eq(
  $$ select a.type::text, cd.elevenlabs_voice_id, cd.physical_attributes ->> 'age'
       from public.assets a join public.character_details cd on cd.asset_id = a.id
      where a.name = 'Mara' and a.project_id = '10330000-0000-4000-8000-000000000001' $$,
  $$ values ('character', 'voice-abc', '30') $$,
  'the asset and its details both exist, with the voice id and attributes'
);

-- A failure while writing the details must take the asset with it.
set local role postgres;
alter table public.character_details
  add constraint fn103_no_boom check (personality is distinct from 'boom');
select makerkit.authenticate_as('fn_owner');

select throws_like(
  $$ select public.create_character_with_details(
       '10330000-0000-4000-8000-000000000001', 'Boom', 'd', '{}'::jsonb, 'boom', 'e', array['u']) $$,
  'Failed to create character:%fn103_no_boom%',
  'a failure writing the details is reported'
);

set local role postgres;
select is(
  (select count(*)::int from public.assets
    where name = 'Boom' and project_id = '10330000-0000-4000-8000-000000000001'),
  0,
  'and the asset it had already inserted is rolled back'
);

-- ---------------------------------------------------------------------------
-- update_episode_with_lock
-- ---------------------------------------------------------------------------
select makerkit.authenticate_as('fn_owner');

select results_eq(
  $$ select success, new_version, conflict_data is null
       from public.update_episode_with_lock(
         '10330000-0000-4000-8000-000000000011', 1, '{"title": "Edited"}') $$,
  $$ values (true, 2, true) $$,
  'an update at the current version succeeds and returns the next version'
);

set local role postgres;
select results_eq(
  $$ select title::text, version from public.episodes
     where id = '10330000-0000-4000-8000-000000000011' $$,
  $$ values ('Edited', 2) $$,
  'and the episode holds the new title and version'
);

select makerkit.authenticate_as('fn_owner');
select results_eq(
  $$ select success, new_version, conflict_data ->> 'title'
       from public.update_episode_with_lock(
         '10330000-0000-4000-8000-000000000011', 1, '{"title": "Stale"}') $$,
  $$ values (false, 2, 'Edited') $$,
  'an update at an old version is refused and returns the current row to resolve against'
);

set local role postgres;
select is(
  (select title::text from public.episodes where id = '10330000-0000-4000-8000-000000000011'),
  'Edited',
  'the refused update changed nothing'
);

-- Two writers both read version 2. The first to write wins; the second, still
-- holding version 2, is told there was a conflict.
select makerkit.authenticate_as('fn_owner');
select results_eq(
  $$ select success, new_version
       from public.update_episode_with_lock(
         '10330000-0000-4000-8000-000000000011', 2, '{"title": "Writer one"}') $$,
  $$ values (true, 3) $$,
  'concurrent editors: the first writer at version 2 succeeds'
);

select results_eq(
  $$ select success, new_version, conflict_data ->> 'title'
       from public.update_episode_with_lock(
         '10330000-0000-4000-8000-000000000011', 2, '{"title": "Writer two"}') $$,
  $$ values (false, 3, 'Writer one') $$,
  'and the second, still at version 2, gets a conflict carrying the first writer''s row'
);

select makerkit.authenticate_as('fn_stranger');
select throws_ok(
  $$ select * from public.update_episode_with_lock(
       '10330000-0000-4000-8000-000000000011', 3, '{"title": "Intruder"}') $$,
  'P0001', 'Access denied: insufficient project permissions',
  'someone outside the project cannot update its episode'
);

-- ---------------------------------------------------------------------------
-- batch_create_shots
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.shots (episode_id, sequence_number, prompt) values
  ('10330000-0000-4000-8000-000000000011', 1, 'old one'),
  ('10330000-0000-4000-8000-000000000011', 2, 'old two');

select makerkit.authenticate_as('fn_owner');

select is(
  (select count(*)::int from public.batch_create_shots(
     '10330000-0000-4000-8000-000000000011',
     '[{"prompt": "wide", "duration_seconds": 5, "camera_direction": "static"},
       {"prompt": "close", "duration_seconds": "12"},
       {"prompt": "no duration given"},
       {"prompt": "junk duration", "duration_seconds": "long"}]')),
  4,
  'batch_create_shots returns one id per shot'
);

set local role postgres;
select results_eq(
  $$ select sequence_number, prompt::text, duration_seconds from public.shots
     where episode_id = '10330000-0000-4000-8000-000000000011' order by sequence_number $$,
  $$ values (1, 'wide', 5), (2, 'close', 12), (3, 'no duration given', 10), (4, 'junk duration', 10) $$,
  'shots are numbered in order, and a missing or non-numeric duration becomes 10'
);

select is(
  (select count(*)::int from public.shots
    where episode_id = '10330000-0000-4000-8000-000000000011' and prompt like 'old %'),
  0,
  'the shots the episode had before are replaced, not added to'
);

select is(
  (select status::text from public.episodes where id = '10330000-0000-4000-8000-000000000011'),
  'storyboard',
  'the episode moves to the storyboard status'
);

select makerkit.authenticate_as('fn_owner');
select is(
  (select count(*)::int from public.batch_create_shots('10330000-0000-4000-8000-000000000011', '[]')),
  0,
  'an empty array creates no shots'
);

set local role postgres;
select is(
  (select count(*)::int from public.shots where episode_id = '10330000-0000-4000-8000-000000000011'),
  0,
  'and still clears the episode''s existing shots'
);

select makerkit.authenticate_as('fn_stranger');
select throws_ok(
  $$ select * from public.batch_create_shots('10330000-0000-4000-8000-000000000011', '[{"prompt": "x"}]') $$,
  'P0001', 'Access denied: insufficient project permissions',
  'someone outside the project cannot replace its shots'
);

-- ---------------------------------------------------------------------------
-- get_project_generation_costs
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.generation_jobs
  (idempotency_key, account_id, project_id, job_type, provider, status, cost_cents, input_data, created_at)
select 'fn103-' || n, '10330000-0000-4000-8000-00000000000a', '10330000-0000-4000-8000-000000000001',
       t, p, s, c, '{}'::jsonb, coalesce(at, now())
from (values
  (1, 'video', 'kling',      'completed', 300, null::timestamptz),
  (2, 'video', 'kling',      'failed',    100, null),
  (3, 'voice', 'elevenlabs', 'completed',  50, null),
  (4, 'music', 'lyria',       'completed',  20, now() - interval '40 days')
) as v(n, t, p, s, c, at);

select makerkit.authenticate_as('fn_owner');

select results_eq(
  $$ select job_type::text, provider::text, total_cost_cents, job_count, completed_count, failed_count
       from public.get_project_generation_costs('10330000-0000-4000-8000-000000000001') $$,
  $$ values ('video', 'kling', 400::bigint, 2::bigint, 1::bigint, 1::bigint),
            ('voice', 'elevenlabs', 50, 1, 1, 0),
            ('music', 'lyria', 20, 1, 1, 0) $$,
  'costs are summed per job type and provider, most expensive first, with completed and failed counts'
);

select results_eq(
  $$ select job_type::text from public.get_project_generation_costs(
       '10330000-0000-4000-8000-000000000001', now() - interval '7 days', null) order by 1 $$,
  $$ values ('video'), ('voice') $$,
  'a start date leaves out the older job'
);

select makerkit.authenticate_as('fn_stranger');
select throws_ok(
  $$ select * from public.get_project_generation_costs('10330000-0000-4000-8000-000000000001') $$,
  'P0001', 'Access denied: insufficient project permissions',
  'someone outside the project cannot read its generation costs'
);

-- ---------------------------------------------------------------------------
-- soft_delete_episode
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.episodes (id, project_id, number, title) values
  ('10330000-0000-4000-8000-000000000012', '10330000-0000-4000-8000-000000000001', 2, 'To delete');
insert into public.shots (id, episode_id, sequence_number, prompt) values
  ('10330000-0000-4000-8000-0000000000a1', '10330000-0000-4000-8000-000000000012', 1, 'shot');
insert into public.generation_jobs
  (idempotency_key, account_id, project_id, job_type, provider, status, cost_cents, input_data, reference_type, reference_id)
select 'fn103-sd-' || st, '10330000-0000-4000-8000-00000000000a', '10330000-0000-4000-8000-000000000001',
       'video', 'kling', st, 0, '{}'::jsonb, 'shot', '10330000-0000-4000-8000-0000000000a1'
from unnest(array['queued', 'processing', 'completed']) as st;

select makerkit.authenticate_as('fn_stranger');
select throws_ok(
  $$ select public.soft_delete_episode('10330000-0000-4000-8000-000000000012') $$,
  'P0001', 'Access denied: only project owners and admins can delete episodes',
  'someone outside the project cannot delete its episode'
);

select makerkit.authenticate_as('fn_owner');
select is(
  public.soft_delete_episode('10330000-0000-4000-8000-000000000012'),
  true,
  'the owner soft-deletes the episode'
);

set local role postgres;
select isnt(
  (select deleted_at from public.episodes where id = '10330000-0000-4000-8000-000000000012'),
  null,
  'the episode is marked deleted, not removed'
);

select results_eq(
  $$ select status::text from public.generation_jobs
      where idempotency_key like 'fn103-sd-%' order by idempotency_key $$,
  $$ values ('completed'), ('cancelled'), ('cancelled') $$,
  'its queued and processing jobs are cancelled and a completed one is left alone'
);

select makerkit.authenticate_as('fn_owner');
select is(
  public.soft_delete_episode('10330000-0000-4000-8000-000000000012'),
  false,
  'deleting it again finds nothing and returns false'
);

select is(
  public.soft_delete_episode('10330000-0000-4000-8000-0000000000ff'),
  false,
  'an episode that does not exist returns false'
);

select * from finish();
rollback;
