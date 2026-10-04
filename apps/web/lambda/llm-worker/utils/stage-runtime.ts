/**
 * What the worker hands a `@kit/generation` stage: its service-role client
 * and the job's user and account as the `Ctx`, the episode context loader
 * (built here because `buildEpisodeContext` reaches the gateway's embedder,
 * which the core never imports), and the run's `write` as the `generate`
 * seam (FILM-1902): the model is reached only through the run the job
 * boundary put in scope, which is checked before every call.

 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { installStageWriters, requireRun } from '@kit/ai-gateway';
import { STAGE_WRITERS } from '@kit/episodes/agent/stage-writers';
import {
  type Brief,
  type Ctx,
  type GenerateResult,
  type RunHandle,
  type RunStageDeps,
  type WriteScope,
  stageCtx,
} from '@kit/generation';
import type { Database } from '@kit/supabase/database';

import { episodeContextLoader } from './episode-context-loader';

export { episodeContextLoader };

/**
 * The orchestrated stages' writers (KB-184), so `run.write` reaches a
 * stage's orchestrator in every worker path: a job's handler and
 * `executeServerRun` alike. Called at boot and by `workerCtx`, never left to
 * a module's side effect, which a `sideEffects: false` bundle may drop.
 */
export function installWorkerStageWriters() {
  installStageWriters(STAGE_WRITERS);
}

/**
 * The stage context for the job's run: the worker's client and identity,
 * plus the run's commit applier (one transaction, the content_revisions
 * snapshot included) and origin stamping (FILM-1903). The run is the one in
 * scope unless given. The commit leaves the run open: a handler works on
 * after it (a quality pass, the chained audio job, the episode link) or
 * commits once per asset, and the job boundary completes the run.
 */
export function workerCtx(
  supabase: SupabaseClient<Database>,
  job: { accountId: string; userId: string },
  run: RunHandle = requireRun('the worker stage context'),
): Ctx {
  installWorkerStageWriters();

  return stageCtx(
    run,
    {
      client: supabase,
      accountId: job.accountId,
      userId: job.userId,
      episodeContext: episodeContextLoader(supabase),
      log: (message) => console.log(message),
    },
    { finalize: false },
  );
}

/** The server writer, through the run in scope: `run.write(brief)`. */
export async function generateWithLambda(
  brief: Brief,
  scope?: WriteScope,
): Promise<GenerateResult> {
  return requireRun(`writing ${brief.stage}:${brief.part.key}`).write(
    brief,
    scope,
  );
}

/**
 * What `runStage` needs from the run: the writer, the run id on the brief,
 * TARGET_CHANGED before commit, and the run the commit stamps.
 */
export function stageRunDeps(
  run: RunHandle = requireRun('running a stage'),
): RunStageDeps {
  return {
    generate: (brief, scope) => run.write(brief, scope),
    runId: run.id,
    beforeCommit: () => run.assertTargetUnchanged(),
    run: (usage) => run.toGenerationRun(usage),
  };
}
