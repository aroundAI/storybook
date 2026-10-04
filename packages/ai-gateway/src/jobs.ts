/**
 * Opening a run for a worker job that is not yet on the generation core
 * (FILM-1903 part B). A web action that used to `queueLlmJob({jobType,
 * payload})` now opens a run whose input carries that job, and dispatches
 * it; the worker loads the run and hands the payload to the same handler.
 * As the stages move onto the core, their entry here goes.
 *
 * The payload is parsed with the job type's schema before the run exists
 * (KB-33), with the authorised target's ids stamped over it (KB-31), so a
 * run never carries a payload its handler would refuse.
 */
import {
  type RunCtx,
  type RunHandle,
  type RunTarget,
  type StageKey,
  type TargetType,
  isRunError,
} from '@kit/generation';
import {
  type LlmJobPayloadInput,
  type LlmJobType,
  parseLlmJobPayload,
} from '@kit/prompt-engine/llm-job-payloads';
import type { LlmJobTarget } from '@kit/prompt-engine/llm-job-target';
import { payloadForTarget } from '@kit/prompt-engine/server';

import { openRun } from './backend';
import { isGatewayError } from './errors';
import { LLM_NOT_CONFIGURED_MESSAGE } from './model-availability';

/** The stage each worker job is an execution of. */
export const STAGE_OF_JOB: Record<LlmJobType, StageKey> = {
  'season-analysis': 'season_analysis',
  'season-outline': 'season_outline',
  'story-ideation': 'ideation',
  'story-generation': 'story',
  'story-refinement': 'story_refinement',
  'screenplay-conversion': 'screenplay',
  'screenplay-refinement': 'screenplay_refinement',
  'shot-generation': 'shots',
  'batch-translate-metadata': 'publish_metadata',
  'analytics-insights': 'analytics_insights',
  'language-insights': 'language_insights',
  'translate-dialogue': 'dialogue_translation',
  'audio-cue-generation': 'audio_cues',
  'audio-file-generation': 'audio_render',
  'fact-extraction': 'fact_extraction',
  'asset-creation': 'asset_description',
};

export interface JobRunParams<T extends LlmJobType> {
  jobType: T;
  /** The user the job runs for; stamped on the payload */
  userId: string;
  /** From an authoriser in `@kit/prompt-engine/llm-job-target` (KB-31) */
  target: LlmJobTarget;
  payload: LlmJobPayloadInput<T>;
  /** The action opening the run, for `generation_runs.origin` */
  name: string;
}

function targetOf(
  jobType: LlmJobType,
  payload: Record<string, unknown>,
  target: LlmJobTarget,
): Pick<RunTarget, 'type' | 'id'> {
  if (
    jobType === 'audio-file-generation' &&
    typeof payload.cueId === 'string'
  ) {
    return { type: 'audio_cue' satisfies TargetType, id: payload.cueId };
  }

  if (target.episodeId) return { type: 'episode', id: target.episodeId };

  if (target.projectId) return { type: 'project', id: target.projectId };

  // No row to lock (a target with neither episode nor project): the batch
  // itself is the target; the account is still a team's (KB-99)
  return { type: 'publish', id: crypto.randomUUID() };
}

/** The run target for a job: its stage's lock, with the job as the input. */
export function jobRunTarget<T extends LlmJobType>(
  params: Omit<JobRunParams<T>, 'name'>,
): RunTarget {
  const payload = parseLlmJobPayload(params.jobType, {
    ...payloadForTarget(
      params.target,
      params.payload as Record<string, unknown>,
    ),
    userId: params.userId,
  }) as Record<string, unknown>;

  const version = payload.version;

  return {
    ...targetOf(params.jobType, payload, params.target),
    accountId: params.target.accountId,
    projectId: params.target.projectId ?? null,
    input: { kind: 'job', jobType: params.jobType, payload },
    targetVersion: typeof version === 'number' ? version : null,
  };
}

export const SERVER_GENERATION_OFF_REFUSAL =
  'This team has server generation turned off. Ask Claude to write it through the MCP connector, or turn server generation on in Team settings under AI.';
export const STAGE_IN_PROGRESS_REFUSAL =
  'This stage is already being generated. Wait for it to finish, or cancel it from the banner.';

/**
 * What to tell the user when opening a job's run was refused for a reason
 * they can act on (FILM-1910), or null. A message, not an error: a server
 * action that is wrapped in `returnRefusals` throws it as an
 * `ActionRefusal`; one that returns its errors as values returns it.
 */
export function runRefusalMessage(error: unknown): string | null {
  if (isRunError(error, 'SERVER_GENERATION_DISABLED')) {
    return SERVER_GENERATION_OFF_REFUSAL;
  }

  if (isRunError(error, 'RUN_IN_PROGRESS')) return STAGE_IN_PROGRESS_REFUSAL;

  // No model key on this deployment (FILM-1911): the gateway's own words
  if (isGatewayError(error, 'LLM_NOT_CONFIGURED')) {
    return LLM_NOT_CONFIGURED_MESSAGE;
  }

  // The cap, today's spend and when it resets, in the gateway's words
  if (isGatewayError(error, 'DAILY_SPEND_CAP_REACHED')) {
    return error.message;
  }

  return null;
}

/**
 * `openRun` for a worker job: the stage is the job's, the input the parsed
 * payload, and the mode server, since every caller dispatches the run to
 * the worker (FILM-1910). Left to the team's default, a team with server
 * generation off got an external run here, which the job row's
 * assert_server_run and dispatch() then refused with a 500, leaving the
 * run open on the stage. A caller that means otherwise passes `runMode`.
 * A refusal is a RunError; `runRefusalMessage` words it for the page.
 */
export function openRunForJob<T extends LlmJobType>(
  params: JobRunParams<T>,
  ctx: RunCtx,
): Promise<RunHandle> {
  return openRun(
    STAGE_OF_JOB[params.jobType],
    jobRunTarget(params),
    { kind: 'web', name: params.name },
    { ...ctx, runMode: ctx.runMode ?? (() => 'server') },
  );
}
