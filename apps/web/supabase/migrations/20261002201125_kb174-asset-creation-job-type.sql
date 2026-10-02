-- KB-174: bulk asset creation was never recorded.
--
-- batchCreateAssetsAction inserts one generation_jobs row per episode with
-- job_type 'asset_creation' (packages/features/episodes/src/server/bulk-actions.ts).
-- This constraint refused the value, so the insert failed, was logged at
-- warn, and the SQS jobs went out with no row behind them: no progress, no
-- status, no cost for the UI to read. 'asset_creation' is the only value a
-- producer inserts today that the list lacked. The LLM job types that never
-- insert a row at all (season-outline, season-analysis, story-ideation,
-- fact-extraction, batch-translate-metadata, analytics-insights,
-- language-insights) are FILM-1903's to add, with run_id, and are not here.
--
-- GENERATION_JOB_TYPES in
-- packages/features/prompt-engine/src/lib/generation-job-types.ts is held
-- to this list by a unit test.
--
-- A strict superset of the previous list: every existing row still passes.
alter table public.generation_jobs
  drop constraint if exists generation_jobs_job_type_check;

alter table public.generation_jobs
  add constraint generation_jobs_job_type_check
  check (job_type in (
    'video', 'voice', 'music', 'sfx',
    'story', 'screenplay', 'shot_list',
    'translate-dialogue', 'audio_cue_generation',
    'story-refinement', 'screenplay-refinement',
    'asset_creation'
  ));

comment on column public.generation_jobs.job_type is
  'Type: video, voice, music, sfx, story, screenplay, shot_list, translate-dialogue, audio_cue_generation, story-refinement, screenplay-refinement, asset_creation';
