/**
 * `generation_jobs.job_type`: the values `generation_jobs_job_type_check`
 * allows. The CHECK is the authority; `generation-job-types.test.ts` holds
 * this list to the latest migration that defines it, to the schema mirror,
 * and to every job_type value a producer inserts.
 *
 * This is not the SQS job type (`LlmJobType` in llm-job-payloads.ts):
 * 'asset-creation' queues the work, 'asset_creation' records it (KB-174).
 * Free of server-only and Next imports so the llm-worker can bundle it.
 */
export const GENERATION_JOB_TYPES = [
  'video',
  'voice',
  'music',
  'sfx',
  'story',
  'screenplay',
  'shot_list',
  'translate-dialogue',
  'audio_cue_generation',
  'story-refinement',
  'screenplay-refinement',
  'asset_creation',
] as const;

export type GenerationJobType = (typeof GENERATION_JOB_TYPES)[number];
