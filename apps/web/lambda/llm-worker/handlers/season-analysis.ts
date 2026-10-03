/**
 * Season Analysis Handler, on the generation core (FILM-1901).
 *
 * prepare (the `season_analysis` stage) renders `season-generation` with the
 * user's roadmap and facts; generate is one direct model call; the stage's
 * output schema is enforced; commit stores the analysis on the project.
 * The analysis is returned to the frontend via WebSocket as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type SeasonAnalysisOutput,
  runStage,
  seasonAnalysisStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

export async function processSeasonAnalysis(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<{ success: boolean; data: SeasonAnalysisOutput }> {
  const data = parseLlmJobPayload('season-analysis', payload);

  console.log(
    `[Season Analysis] Processing for project ${data.projectId}, facts: ${data.externalFacts?.length ?? 0}`,
  );

  const ctx = workerCtx(supabase, {
    accountId: data.accountId,
    userId: data.userId ?? '',
  });
  const target = seasonAnalysisStage.targetSchema.parse(data);

  const { commit } = await runStage(
    seasonAnalysisStage,
    ctx,
    target,
    stageRunDeps(),
  );

  const result = commit.data.analysis;

  console.log('[Season Analysis] Success:', {
    episodeCount: result.episodes.length,
    characterCount: result.characters.length,
    locationCount: result.locations.length,
    factsAssigned: result.episodes.reduce(
      (sum, ep) => sum + (ep.fact_ids?.length ?? 0),
      0,
    ),
  });

  return { success: true, data: result };
}
