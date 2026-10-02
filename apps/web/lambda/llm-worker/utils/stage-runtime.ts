/**
 * What the worker hands a `@kit/generation` stage: its service-role client
 * and the job's user and account as the `Ctx`, the episode context loader
 * (built here because `buildEpisodeContext` reaches the Voyage embedder,
 * which the core never imports), and today's executor as the `generate`
 * seam. FILM-1902's `run.write` replaces `generateWithLambda`; FILM-1903
 * fills `revisions` and `originColumnsAvailable`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Brief,
  Ctx,
  EpisodeContextLoader,
  GenerateResult,
} from '@kit/generation';
import type { Database } from '@kit/supabase/database';

import { executeLLMForLambda } from '../llm-utils';
import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatLocationsForPrompt,
  formatPreviousEpisodesForPrompt,
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
      characters: formatCharactersForPrompt(context.characters),
      locations: formatLocationsForPrompt(context.locations),
      previousEpisodes: formatPreviousEpisodesForPrompt(
        context.previousEpisodes,
      ),
      counts: {
        characters: context.characters.length,
        locations: context.locations.length,
      },
    };
  };
}

export function workerCtx(
  supabase: SupabaseClient<Database>,
  job: { accountId: string; userId: string },
): Ctx {
  return {
    client: supabase,
    accountId: job.accountId,
    userId: job.userId,
    episodeContext: episodeContextLoader(supabase),
    log: (message) => console.log(message),
  };
}

/** The server writer: the brief's prompt, rendered and sent by the executor. */
export async function generateWithLambda(
  brief: Brief,
): Promise<GenerateResult> {
  const result = await executeLLMForLambda<unknown>({
    templateSlug: brief.prompt.slug,
    variables: brief.prompt.variables,
  });

  return {
    output: result.data,
    usage: {
      provider: result.metadata.provider,
      model: result.metadata.model,
      tokens: result.metadata.tokens,
      latencyMs: result.metadata.latency,
    },
  };
}
