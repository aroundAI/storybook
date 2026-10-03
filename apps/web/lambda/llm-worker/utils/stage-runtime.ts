/**
 * What the worker hands a `@kit/generation` stage: its service-role client
 * and the job's user and account as the `Ctx`, the episode context loader
 * (built here because `buildEpisodeContext` reaches the gateway's embedder,
 * which the core never imports), and the run's `write` as the `generate`
 * seam (FILM-1902): the model is reached only through the run the job
 * boundary put in scope, which is checked before every call.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRun } from '@kit/ai-gateway';
import {
  type Brief,
  type Ctx,
  type EpisodeContextLoader,
  type GenerateResult,
  type RunHandle,
  type RunStageDeps,
  stageCtx,
} from '@kit/generation';
import type { Database } from '@kit/supabase/database';

import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatCharactersForVeoPrompt,
  formatFactsForPrompt,
  formatLocationsForPrompt,
  formatLocationsForVeoPrompt,
  formatPreviousEpisodesForPrompt,
  formatRecurringElementsForPrompt,
  formatVerifiedFactsForPrompt,
} from './context-builder';

export function episodeContextLoader(
  supabase: SupabaseClient<Database>,
): EpisodeContextLoader {
  return async (episodeId, options) => {
    const context = await buildEpisodeContext(episodeId, supabase, {
      semanticContext: options.semanticQuery !== undefined,
      semanticQuery: options.semanticQuery,
    });

    return {
      episodeNumber: context.episodeNumber,
      seasonNumber: context.seasonNumber,
      seasonPremise: context.seasonPremise,
      seasonDirectionNotes: context.seasonDirectionNotes,
      premise: context.premise,
      genre: context.genre,
      targetAudience: context.targetAudience,
      visualStyle: context.visualStyle,
      projectType: context.projectType,
      characters: formatCharactersForPrompt(context.characters),
      locations: formatLocationsForPrompt(context.locations),
      previousEpisodes: formatPreviousEpisodesForPrompt(
        context.previousEpisodes,
      ),
      previousEpisodeTitles: context.previousEpisodes.map((ep) => ({
        number: ep.number,
        title: ep.title,
      })),
      episodeFacts: formatFactsForPrompt(context.episodeFacts),
      verifiedFacts:
        context.verifiedFacts.length > 0
          ? formatVerifiedFactsForPrompt(context.verifiedFacts)
          : undefined,
      counts: {
        characters: context.characters.length,
        locations: context.locations.length,
      },
      // The VEO 3.1 form the shots stage prompts with, and the names its
      // referential checks compare against
      charactersVeo: formatCharactersForVeoPrompt(context.characters),
      locationsVeo: formatLocationsForVeoPrompt(context.locations),
      recurringElements: formatRecurringElementsForPrompt(
        context.recurringElements,
      ),
      characterNames: context.characters.map((c) => c.name),
      locationNames: context.locations.map((l) => l.name),
      characterList: context.characters.map(({ id, name }) => ({ id, name })),
      locationList: context.locations.map(({ id, name }) => ({ id, name })),
    };
  };
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
): Promise<GenerateResult> {
  return requireRun(`writing ${brief.stage}:${brief.part.key}`).write(brief);
}

/**
 * What `runStage` needs from the run: the writer, the run id on the brief,
 * TARGET_CHANGED before commit, and the run the commit stamps.
 */
export function stageRunDeps(
  run: RunHandle = requireRun('running a stage'),
): RunStageDeps {
  return {
    generate: (brief) => run.write(brief),
    runId: run.id,
    beforeCommit: () => run.assertTargetUnchanged(),
    run: (usage) => run.toGenerationRun(usage),
  };
}
