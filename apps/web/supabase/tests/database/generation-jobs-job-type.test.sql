begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(5);

-- KB-14. refineStoryAction / refineScreenplayAction record their jobs as
-- 'story-refinement' / 'screenplay-refinement', and the llm-worker updates
-- those rows. generation_jobs_job_type_check did not allow either value, so
-- every refinement insert failed and was logged and ignored. The inserts
-- below use the columns refinement-actions.ts writes.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

set local role postgres;

select set_config('gj.account', makerkit.get_account_id_by_slug('storybook')::text, true);

-- The account owner creates the project: the creator trigger on `projects`
-- reads auth.uid(), which is null when inserting as postgres.
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('6b6b6b6b-0000-4000-8000-000000000001',
          current_setting('gj.account')::uuid, 'Job type fixture', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('6b6b6b6b-0000-4000-8000-000000000002',
          '6b6b6b6b-0000-4000-8000-000000000001', 1, 'E1', 'draft');

select lives_ok(
  $$ insert into public.generation_jobs
       (reference_type, reference_id, job_type, status, account_id, project_id,
        idempotency_key, input_data)
     values ('episode', '6b6b6b6b-0000-4000-8000-000000000002', 'story-refinement',
             'queued', current_setting('gj.account')::uuid,
             '6b6b6b6b-0000-4000-8000-000000000001',
             'story-refinement-kb14-1', '{"feedback": "tighter"}') $$,
  'a story refinement can be recorded'
);

select lives_ok(
  $$ insert into public.generation_jobs
       (reference_type, reference_id, job_type, status, account_id, project_id,
        idempotency_key, input_data)
     values ('episode', '6b6b6b6b-0000-4000-8000-000000000002', 'screenplay-refinement',
             'queued', current_setting('gj.account')::uuid,
             '6b6b6b6b-0000-4000-8000-000000000001',
             'screenplay-refinement-kb14-1', '{"feedback": "tighter"}') $$,
  'a screenplay refinement can be recorded'
);

-- The worker's markJobProcessing, verbatim filter: it now finds the row.
update public.generation_jobs set status = 'processing', started_at = now()
 where reference_type = 'episode'
   and reference_id = '6b6b6b6b-0000-4000-8000-000000000002'
   and job_type = 'story-refinement'
   and status = 'queued';

select is(
  (select status from public.generation_jobs
    where idempotency_key = 'story-refinement-kb14-1'),
  'processing',
  'the worker''s status update now reaches the refinement row'
);

select lives_ok(
  $$ insert into public.generation_jobs
       (reference_type, reference_id, job_type, status, account_id, project_id,
        idempotency_key, input_data)
     values ('episode', '6b6b6b6b-0000-4000-8000-000000000002', 'story',
             'queued', current_setting('gj.account')::uuid,
             '6b6b6b6b-0000-4000-8000-000000000001',
             'story-kb14-1', '{}') $$,
  'existing job types are still allowed'
);

select throws_ok(
  $$ insert into public.generation_jobs
       (reference_type, reference_id, job_type, status, account_id, project_id,
        idempotency_key, input_data)
     values ('episode', '6b6b6b6b-0000-4000-8000-000000000002', 'bogus',
             'queued', current_setting('gj.account')::uuid,
             '6b6b6b6b-0000-4000-8000-000000000001',
             'bogus-kb14-1', '{}') $$,
  '23514',
  null,
  'an unknown job type is still refused'
);

select * from finish();

rollback;
