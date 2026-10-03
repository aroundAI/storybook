begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(19);

-- FILM-1903 part C: an LLM job and a model-usage row cannot exist without a
-- run. Rows written before part C keep their null run and stay writable, and
-- deleting a run still clears the column on its rows.

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('rq.team', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('rq.owner', tests.get_supabase_uid('owner')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19031000-0000-4000-8000-000000000001', current_setting('rq.team')::uuid, 'FILM-1903 part C', 'active');

insert into public.episodes (id, project_id, number, title) values
  ('19031000-0000-4000-8000-000000000011', '19031000-0000-4000-8000-000000000001', 1, 'Ep 1'),
  ('19031000-0000-4000-8000-000000000012', '19031000-0000-4000-8000-000000000001', 2, 'Ep 2');

-- An open server run, and one that will be deleted
insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by)
values
  ('19031000-0000-4000-8000-0000000000a1', current_setting('rq.team')::uuid,
   '19031000-0000-4000-8000-000000000001', 'episode', '19031000-0000-4000-8000-000000000011',
   'story', 'server', current_setting('rq.owner')::uuid),
  ('19031000-0000-4000-8000-0000000000a2', current_setting('rq.team')::uuid,
   '19031000-0000-4000-8000-000000000001', 'episode', '19031000-0000-4000-8000-000000000012',
   'story', 'server', current_setting('rq.owner')::uuid);

-- Whether a job of this type, with no run, is refused for having no run
create function pg_temp.refused_without_run(t text) returns boolean
language plpgsql as $$
begin
  insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data)
  values ('rq-probe-' || t, current_setting('rq.team')::uuid,
          '19031000-0000-4000-8000-000000000001', t, '{}'::jsonb);
  raise exception 'rq-probe-accepted';
exception
  when others then
    if sqlerrm like 'refused: generation_jobs row without a run%' then
      return true;
    elsif sqlerrm = 'rq-probe-accepted' then
      return false;
    end if;
    raise;
end;
$$;

-- ------------------------------------------------------------------
-- New rows need a run
-- ------------------------------------------------------------------
select throws_like(
  $$ insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data)
     values ('rq-story-norun', current_setting('rq.team')::uuid, '19031000-0000-4000-8000-000000000001',
             'story', '{}'::jsonb) $$,
  'refused: generation_jobs row without a run%',
  'C1 a story job with no run is refused'
);

-- Every job type generation_jobs_job_type_check allows is locked, except the
-- vendor renders: read from the constraint, so a type added later is covered
select results_eq(
  $$ select t from (
       select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1] as t
         from pg_constraint c
        where c.conrelid = 'public.generation_jobs'::regclass
          and c.conname = 'generation_jobs_job_type_check'
     ) allowed
     where not pg_temp.refused_without_run(t)
     order by t $$,
  $$ values ('music'), ('sfx'), ('video'), ('voice') $$,
  'C2 every job type the CHECK allows is refused without a run, except the four vendor renders'
);

select lives_ok(
  $$ insert into public.generation_jobs (idempotency_key, account_id, project_id, job_type, input_data)
     values ('rq-voice-norun', current_setting('rq.team')::uuid, '19031000-0000-4000-8000-000000000001',
             'voice', '{}'::jsonb) $$,
  'C3 a voice render with no run is accepted: renders make no model call'
);

select throws_like(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status)
     values (current_setting('rq.team')::uuid, 'story-generation', 'gemini', 'gemini-2.5-pro', 'success') $$,
  'refused: llm_usage_analytics row without a run%',
  'C4 a usage row with no run is refused'
);

select lives_ok(
  $$ insert into public.generation_jobs (id, idempotency_key, account_id, project_id, job_type, input_data, run_id)
     values ('19031000-0000-4000-8000-0000000000d1', 'rq-story-run', current_setting('rq.team')::uuid,
             '19031000-0000-4000-8000-000000000001', 'story', '{}'::jsonb, '19031000-0000-4000-8000-0000000000a2') $$,
  'C5 a story job on an open server run is accepted'
);

select lives_ok(
  $$ insert into public.llm_usage_analytics (id, account_id, template_slug, llm_provider, llm_model, status, run_id)
     values ('19031000-0000-4000-8000-0000000000f1', current_setting('rq.team')::uuid, 'story-generation',
             'gemini', 'gemini-2.5-pro', 'success', '19031000-0000-4000-8000-0000000000a2') $$,
  'C6 a usage row on an open server run is accepted'
);

-- ------------------------------------------------------------------
-- A row cannot shed its run, or change into a locked type without one
-- ------------------------------------------------------------------
select throws_like(
  $$ update public.generation_jobs set run_id = null where id = '19031000-0000-4000-8000-0000000000d1' $$,
  'refused: generation_jobs row without a run%',
  'C7 clearing a job''s run is refused'
);

select throws_like(
  $$ update public.llm_usage_analytics set run_id = null where id = '19031000-0000-4000-8000-0000000000f1' $$,
  'refused: llm_usage_analytics row without a run%',
  'C8 clearing a usage row''s run is refused'
);

select throws_like(
  $$ update public.generation_jobs set job_type = 'story' where idempotency_key = 'rq-voice-norun' $$,
  'refused: generation_jobs row without a run%',
  'C9 turning a render job with no run into a story job is refused'
);

-- ------------------------------------------------------------------
-- Rows written before part C: no run, and still writable
-- ------------------------------------------------------------------
-- replica skips user triggers, which is how the rows look to the new trigger:
-- they were inserted before it existed
set local session_replication_role = replica;
insert into public.generation_jobs (id, idempotency_key, account_id, project_id, job_type, status, input_data,
                                    reference_type, reference_id)
values ('19031000-0000-4000-8000-0000000000d9', 'rq-historic', current_setting('rq.team')::uuid,
        '19031000-0000-4000-8000-000000000001', 'story', 'queued', '{}'::jsonb,
        'episode', '19031000-0000-4000-8000-000000000011');
insert into public.llm_usage_analytics (id, account_id, template_slug, llm_provider, llm_model, status)
values ('19031000-0000-4000-8000-0000000000f9', current_setting('rq.team')::uuid, 'story-generation',
        'gemini', 'gemini-2.5-pro', 'success');
set local session_replication_role = origin;

-- The worker's markJobProcessing / markJobCompleted, and reset-to-storyboard
select lives_ok(
  $$ update public.generation_jobs set status = 'processing', started_at = now()
      where reference_type = 'episode' and reference_id = '19031000-0000-4000-8000-000000000011'
        and job_type = 'story' and status = 'queued' $$,
  'C10 a job queued before part C can still be marked processing'
);

select lives_ok(
  $$ update public.generation_jobs set status = 'failed', error_message = 'Cancelled', completed_at = now()
      where id = '19031000-0000-4000-8000-0000000000d9' $$,
  'C11 a job queued before part C can still be cancelled'
);

select is(
  (select status || ':' || coalesce(run_id::text, 'no run') from public.generation_jobs
    where id = '19031000-0000-4000-8000-0000000000d9'),
  'failed:no run',
  'C12 the historical job keeps its null run'
);

select lives_ok(
  $$ update public.llm_usage_analytics set error_message = 'annotated'
      where id = '19031000-0000-4000-8000-0000000000f9' $$,
  'C13 a usage row written before part C is still writable'
);

select is(
  (select count(*)::int from public.llm_usage_analytics
    where id = '19031000-0000-4000-8000-0000000000f9' and run_id is null),
  1,
  'C14 the historical usage row keeps its null run'
);

-- ------------------------------------------------------------------
-- Deleting a run still clears run_id on its rows (on delete set null)
-- ------------------------------------------------------------------
select lives_ok(
  $$ delete from public.generation_runs where id = '19031000-0000-4000-8000-0000000000a2' $$,
  'C15 a run with a job and a usage row can be deleted'
);

select is(
  (select run_id from public.generation_jobs where id = '19031000-0000-4000-8000-0000000000d1'),
  null,
  'C16 its job keeps the row with no run'
);

select is(
  (select run_id from public.llm_usage_analytics where id = '19031000-0000-4000-8000-0000000000f1'),
  null,
  'C17 its usage row keeps the row with no run'
);

-- ------------------------------------------------------------------
-- A call with no prompt (an embedding, #580) writes a null template_slug:
-- the lock is the same
-- ------------------------------------------------------------------
select lives_ok(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status, run_id)
     values (current_setting('rq.team')::uuid, null, 'voyage', 'voyage-3.5', 'success',
             '19031000-0000-4000-8000-0000000000a1') $$,
  'C18 an embedding''s usage row (no template) on an open server run is accepted'
);

select throws_like(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status)
     values (current_setting('rq.team')::uuid, null, 'voyage', 'voyage-3.5', 'success') $$,
  'refused: llm_usage_analytics row without a run%',
  'C19 an embedding''s usage row with no run is refused'
);

select * from finish();

rollback;
