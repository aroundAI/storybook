/**
 * Story Ideation Handler, on the generation core (FILM-1901).
 *
 * prepare (the `ideation` stage) builds the brief from the episode's
 * context; generate runs the Ideation Orchestrator (generateIdeas →
 * evaluateIdeas → regenerate weak, max 1 cycle); the stage's output schema
 * is enforced; commit stores the ideas on episodes.metadata.ideas. The
 * ideas are returned to the frontend via WebSocket as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ideationOrchestratorInput,
  ideationStage,
  runStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface StoryIdea {
  title: string;
  logline: string;
  hook: string;
  conflict?: string;
  themes: string[];
  visualPotential: string;
  qualityScore?: number;
}

interface StoryIdeationResult {
  success: boolean;
  data: {
    ideas: StoryIdea[];
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
      orchestratorSteps?: number;
    };
  };
}

export async function processStoryIdeation(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<StoryIdeationResult> {
  const data = parseLlmJobPayload('story-ideation', payload);

  console.log(
    `[Story Ideation] Starting AGENTIC pipeline for episode ${data.episodeId}`,
  );

  const ctx = workerCtx(supabase, data);
  const target = ideationStage.targetSchema.parse({
    episodeId: data.episodeId,
    premise: data.premise || undefined,
    numberOfIdeas: data.numberOfIdeas || 3,
  });

  let orchestratorSteps: number | undefined;

  const { commit } = await runStage(ideationStage, ctx, target, {
    ...stageRunDeps(),
    generate: async (brief) => {
      const { runIdeationOrchestrator } = await import(
        '@kit/episodes/agent/ideation-orchestrator'
      );

      const orchestratorResult = await runIdeationOrchestrator({
        ...ideationOrchestratorInput(brief),
        episodeId: target.episodeId,
        accountId: data.accountId,
      });

      if (!orchestratorResult.success) {
        throw new Error(
          `Ideation Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      orchestratorSteps = orchestratorResult.orchestratorSteps;

      console.log(
        `[Story Ideation] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, Ideas: ${orchestratorResult.ideas.length}`,
      );

      return {
        output: { ideas: orchestratorResult.ideas },
        usage: { provider: 'orchestrator', model: 'multi-agent', tokens: 0 },
      };
    },
  });

  if (commit.status === 'skipped') {
    console.warn(`[Story Ideation] Ideas not stored: ${commit.reason}`);
  }

  return {
    success: true,
    data: {
      ideas: commit.data.ideas,
      metadata: {
        provider: 'orchestrator',
        model: 'multi-agent',
        costCents: 0,
        tokensUsed: 0,
        generatedAt: commit.data.generatedAt,
        orchestratorSteps,
      },
    },
  };
}
