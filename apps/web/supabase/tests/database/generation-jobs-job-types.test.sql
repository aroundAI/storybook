begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- KB-174. batchCreateAssetsAction records each episode's job as
-- 'asset_creation' (packages/features/episodes/src/server/bulk-actions.ts),
-- and generation_jobs_job_type_check refused the value, so bulk asset
-- creation ran with no job row. The list below is the whole CHECK as
-- `apps/web/supabase/migrations/*_kb174-asset-creation-job-type.sql` leaves
-- it; `GENERATION_JOB_TYPES` in
-- packages/features/prompt-engine/src/lib/generation-job-types.ts is held to
-- the same list by generation-job-types.test.ts. The inserts use the columns
-- the bulk actions write.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

set local role postgres;

select set_config('gj.account', makerkit.get_account_id_by_slug('storybook')::text, true);

-- The account owner creates the project: the creator trigger on `projects`
-- reads auth.uid(), which is null when inserting as postgres.
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('6c6c6c6c-0000-4000-8000-000000000001',
          current_setting('gj.account')::uuid, 'Job types fixture', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('6c6c6c6c-0000-4000-8000-000000000002',
          '6c6c6c6c-0000-4000-8000-000000000001', 1, 'E1', 'draft');

-- Every job type some producer inserts today, plus the four provider types
-- the table was created with: each can be recorded.
select lives_ok(
  format(
    $$ insert into public.generation_jobs
         (reference_type, reference_id, job_type, status, account_id, project_id,
          idempotency_key, input_data)
       values ('episode', '6c6c6c6c-0000-4000-8000-000000000002', %L,
               'queued', current_setting('gj.account')::uuid,
               '6c6c6c6c-0000-4000-8000-000000000001',
               %L, '{}') $$,
    t.job_type, 'kb174-' || t.job_type
  ),
  format('a %s job can be recorded', t.job_type)
)
from unnest(array[
  'video', 'voice', 'music', 'sfx',
  'story', 'screenplay', 'shot_list',
  'translate-dialogue', 'audio_cue_generation',
  'story-refinement', 'screenplay-refinement',
  'asset_creation'
]) as t(job_type);

-- The worker's markJobProcessing, verbatim filter: it finds the asset row.
update public.generation_jobs set status = 'processing', started_at = now()
 where reference_type = 'episode'
   and reference_id = '6c6c6c6c-0000-4000-8000-000000000002'
   and job_type = 'asset_creation'
   and status = 'queued';

select is(
  (select status from public.generation_jobs
    where idempotency_key = 'kb174-asset_creation'),
  'processing',
  'the worker''s status update reaches the asset creation row'
);

select throws_ok(
  $$ insert into public.generation_jobs
       (reference_type, reference_id, job_type, status, account_id, project_id,
        idempotency_key, input_data)
     values ('episode', '6c6c6c6c-0000-4000-8000-000000000002', 'asset-creation',
             'queued', current_setting('gj.account')::uuid,
             '6c6c6c6c-0000-4000-8000-000000000001',
             'kb174-bogus', '{}') $$,
  '23514',
  null,
  'the SQS spelling, and any other unknown job type, is refused'
);

select * from finish();

rollback;
