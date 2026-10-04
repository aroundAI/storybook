begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(5);

-- KB-188: a story run is briefed at the episode version the page sent. The
-- Story Orchestrator used to store its viral score with a plain update
-- mid-run; the update trigger bumped episodes.version, and the run's own
-- commit was refused with TARGET_CHANGED. The score now rides in the
-- story's plan, so the allowlist takes viral_quality on episodes updates.

select makerkit.set_identifier('owner', 'owner@storybook.dev');

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('vq.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('18800000-0000-4000-8000-000000000001', current_setting('vq.team')::uuid, 'KB-188 P', 'active');

insert into public.episodes (id, project_id, number, title, status) values
  ('18800000-0000-4000-8000-000000000011', '18800000-0000-4000-8000-000000000001', 1, 'Mid-run', 'draft'),
  ('18800000-0000-4000-8000-000000000012', '18800000-0000-4000-8000-000000000001', 2, 'In the plan', 'draft');

select tests.authenticate_as_service_role();

-- A server story run on an episode, briefed at its current version, as
-- openRunForJob opens one from Generate Story
create function pg_temp.open_story_run(p_episode uuid)
returns uuid language sql as $$
  select (public.open_generation_run(
    p_account_id := current_setting('vq.team')::uuid,
    p_project_id := '18800000-0000-4000-8000-000000000001',
    p_target_type := 'episode', p_target_id := p_episode,
    p_stage := 'story', p_mode := 'server',
    p_input := '{}'::jsonb, p_origin := '{}'::jsonb,
    p_created_by := tests.get_supabase_uid('owner'),
    p_target_version := (select version from public.episodes where id = p_episode)
  ) -> 'run' ->> 'id')::uuid
$$;

create function pg_temp.story_plan(p_episode uuid, p_values jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('ops', jsonb_build_array(jsonb_build_object(
    'key', 'episode', 'op', 'update', 'table', 'episodes', 'requireRows', true,
    'values', jsonb_build_object('story_data', '{"fullStory": "The letter."}'::jsonb, 'status', 'story') || p_values,
    'match', jsonb_build_array(
      jsonb_build_object('column', 'id', 'op', 'eq', 'value', p_episode),
      jsonb_build_object('column', 'deleted_at', 'op', 'is', 'value', null)),
    'returning', jsonb_build_array('id', 'version'))))
$$;

-- ------------------------------------------------------------------
-- V1: what the flow saw: a write to the episode mid-run, then the commit
-- ------------------------------------------------------------------
select set_config('vq.run1', pg_temp.open_story_run('18800000-0000-4000-8000-000000000011')::text, true);

-- The orchestrator's old mid-run write
update public.episodes set viral_quality = '{"overallScore": 0.8}'::jsonb
  where id = '18800000-0000-4000-8000-000000000011';

select is(
  public.apply_generation_commit(
    current_setting('vq.run1')::uuid,
    pg_temp.story_plan('18800000-0000-4000-8000-000000000011', '{}'::jsonb)
  ) ->> 'code',
  'TARGET_CHANGED',
  'V1 a write to the episode during the story run makes its own commit refused'
);

select is(
  (select story_data from public.episodes where id = '18800000-0000-4000-8000-000000000011'),
  null,
  'V1 nothing of the story was written'
);

-- ------------------------------------------------------------------
-- V2: the score in the story's plan, in the run's one transaction
-- ------------------------------------------------------------------
select set_config('vq.run2', pg_temp.open_story_run('18800000-0000-4000-8000-000000000012')::text, true);

select is(
  public.apply_generation_commit(
    current_setting('vq.run2')::uuid,
    pg_temp.story_plan('18800000-0000-4000-8000-000000000012',
      '{"viral_quality": {"overallScore": 0.8, "decision": "pass"}}'::jsonb)
  ) ->> 'ok',
  'true',
  'V2 the story commit stores viral_quality with the story'
);

select is(
  (select viral_quality ->> 'overallScore' from public.episodes
    where id = '18800000-0000-4000-8000-000000000012'),
  '0.8',
  'V2 the score is on the episode'
);

select is(
  (select status from public.generation_runs where id = current_setting('vq.run2')::uuid),
  'committed',
  'V2 the story run is committed'
);

select * from finish();
rollback;
