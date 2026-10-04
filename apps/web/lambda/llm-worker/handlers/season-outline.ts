/**
 * Season Outline Handler, on the generation core (FILM-1901).
 *
 * prepare (the `season_outline` stage) reads the project's characters,
 * locations and verified facts (KB-71) and builds the brief; `run.write`
 * reaches the stage's writer, the Season Orchestrator (generateSeasonOutline → evaluateSeasonArc →
 * revise weak episodes, max 1 cycle); the stage's output schema is
 * enforced; commit creates the episode rows. The outlines go back to the
 * frontend for preview via WebSocket, each carrying its row's id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { runStage, seasonOutlineStage } from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface EpisodeOutline {
  id: string;
  number: number;
  title: string;
  premise: string;
  mainPlot: string;
  characterFocus?: string[];
  arcPosition: string;
  fact_ids?: string[];
}

interface SeasonOutlineResult {
  success: boolean;
  data: {
    episodes: EpisodeOutline[];
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
      orchestratorSteps?: number;
      arcScore?: number;
      arcSummary?: string;
    };
  };
}

export async function processSeasonOutline(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<SeasonOutlineResult> {
  const data = parseLlmJobPayload('season-outline', payload);

  console.log(
    `[Season Outline] Starting AGENTIC pipeline for ${data.episodeCount} episodes`,
  );

  const ctx = workerCtx(supabase, data);
  const target = seasonOutlineStage.targetSchema.parse(data);

  const { commit, run } = await runStage(
    seasonOutlineStage,
    ctx,
    target,
    stageRunDeps(),
  );
  const evaluation = (run.diagnostics ?? {}) as {
    arcScore?: number;
    arcSummary?: string;
    orchestratorSteps?: number;
  };

  return {
    success: true,
    data: {
      episodes: commit.data.episodes,
      metadata: {
        provider: 'orchestrator',
        model: 'multi-agent',
        costCents: 0,
        tokensUsed: 0,
        generatedAt: commit.data.generatedAt,
        orchestratorSteps: evaluation.orchestratorSteps,
        arcScore: evaluation.arcScore,
        arcSummary: evaluation.arcSummary,
      },
    },
  };
}
