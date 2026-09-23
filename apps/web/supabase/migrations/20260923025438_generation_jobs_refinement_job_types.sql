-- KB-14: story and screenplay refinements were never recorded.
--
-- refineStoryAction / refineScreenplayAction insert generation_jobs rows with
-- job_type 'story-refinement' / 'screenplay-refinement'
-- (packages/features/episodes/src/lib/server/mutations/refinement-actions.ts),
-- and the llm-worker moves them through processing -> completed | failed.
-- This constraint rejected both values, so the insert failed (logged at warn,
-- then ignored) and the worker's updates matched no row.
--
-- A strict superset of the previous list: every existing row still passes.
-- Rolling back requires deleting or relabelling refinement rows first.
alter table public.generation_jobs
  drop constraint if exists generation_jobs_job_type_check;

alter table public.generation_jobs
  add constraint generation_jobs_job_type_check
  check (job_type in (
    'video', 'voice', 'music', 'sfx',
    'story', 'screenplay', 'shot_list',
    'translate-dialogue', 'audio_cue_generation',
    'story-refinement', 'screenplay-refinement'
  ));
