/**
 * Screenplay Refinement Handler
 *
 * Refines an existing screenplay based on user feedback. The work is the
 * `screenplay_refinement` stage of `@kit/generation` (FILM-1901): prepare
 * builds the brief, the executor writes, the output is checked against the
 * stage's schema, and commit saves `screenplay_data`, keeps the previous
 * screenplay for undo, records the refinement history, rebuilds the
 * dialogue_lines and closes the generation_jobs row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { runStage, screenplayRefinementStage } from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { generateWithLambda, workerCtx } from '../utils/stage-runtime';

interface ScreenplayRefinementResult {
  success: boolean;
  data: {
    screenplay: Record<string, unknown>;
    refinementApplied: boolean;
    episode: {
      id: string;
      status: string;
    };
    metadata: {
      provider: string;
      model: string;
      generatedAt: string;
    };
  };
}

export async function processScreenplayRefinement(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<ScreenplayRefinementResult> {
  const data = parseLlmJobPayload('screenplay-refinement', payload);

  console.log(
    `[Screenplay Refinement] Processing for episode ${data.episodeId}`,
  );

  const ctx = workerCtx(supabase, data);

  const { commit, usage } = await runStage(
    screenplayRefinementStage,
    ctx,
    { episodeId: data.episodeId, feedback: data.feedback },
    // The usage row keeps the job's name, as the handler's executor call did
    { generate: generateWithLambda(ctx, 'screenplay-refinement') },
  );

  if (commit.status === 'skipped') {
    return {
      success: false,
      data: {
        screenplay: {},
        refinementApplied: false,
        episode: commit.data.episode,
        metadata: {
          provider: 'skipped',
          model: 'skipped',
          generatedAt: commit.data.generatedAt,
        },
      },
    };
  }

  return {
    success: true,
    data: {
      screenplay: commit.data.screenplayData,
      refinementApplied: true,
      episode: commit.data.episode,
      metadata: {
        provider: usage?.provider ?? 'unknown',
        model: usage?.model ?? 'unknown',
        generatedAt: commit.data.generatedAt,
      },
    },
  };
}
