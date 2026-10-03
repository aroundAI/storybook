/**
 * Season Outline Handler, on the generation core (FILM-1901).
 *
 * prepare (the `season_outline` stage) reads the project's characters,
 * locations and verified facts (KB-71) and builds the brief; generate runs
 * the Season Orchestrator (generateSeasonOutline → evaluateSeasonArc →
 * revise weak episodes, max 1 cycle); the stage's output schema is
 * enforced; commit creates the episode rows. The outlines go back to the
 * frontend for preview via WebSocket, each carrying its row's id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runStage,
  seasonOutlineOrchestratorInput,
  seasonOutlineStage,
} from '@kit/generation';
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

  let evaluation: {
    arcScore?: number;
    arcSummary?: string;
    orchestratorSteps?: number;
  } = {};

  const { commit } = await runStage(seasonOutlineStage, ctx, target, {
    ...stageRunDeps(),
    generate: async (brief) => {
      const { runSeasonOrchestrator } = await import(
        '@kit/episodes/agent/season-orchestrator'
      );

      const orchestratorResult = await runSeasonOrchestrator({
        ...seasonOutlineOrchestratorInput(brief),
        projectId: target.projectId,
        accountId: data.accountId,
      });

      if (!orchestratorResult.success) {
        throw new Error(
          `Season Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      evaluation = {
        arcScore: orchestratorResult.arcScore,
        arcSummary: orchestratorResult.arcSummary,
        orchestratorSteps: orchestratorResult.orchestratorSteps,
      };

      console.log(
        `[Season Outline] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, ` +
          `Episodes: ${orchestratorResult.episodes.length}, Arc score: ${orchestratorResult.arcScore?.toFixed(2) ?? 'N/A'}`,
      );

      return {
        output: { episodes: orchestratorResult.episodes, evaluation },
        usage: { provider: 'orchestrator', model: 'multi-agent', tokens: 0 },
      };
    },
  });

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
