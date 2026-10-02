/**
 * Generation Job Tracking Utilities for Lambda
 *
 * The functions live in `@kit/generation` (FILM-1901), where a stage's
 * commit owns the bookkeeping; this module keeps the worker's import path.
 * The job type is `@kit/prompt-engine/generation-job-types`'s, the one copy
 * held to generation_jobs_job_type_check (KB-174). Lambda handlers can't
 * import from @kit/episodes/server.
 */
export {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
  type GenerationJobStatus,
  type GenerationJobType,
} from '@kit/generation';
