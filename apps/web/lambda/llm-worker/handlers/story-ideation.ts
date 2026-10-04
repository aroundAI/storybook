/**
 * Story Ideation Handler, on the generation core (FILM-1901).
 *
 * prepare (the `ideation` stage) builds the brief from the episode's
 * context; `run.write` reaches the stage's writer, the Ideation Orchestrator (generateIdeas →
 * evaluateIdeas → regenerate weak, max 1 cycle); the stage's output schema
 * is enforced; commit stores the ideas on episodes.metadata.ideas. The
 * ideas are returned to the frontend via WebSocket as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { ideationStage, runStage } from '@kit/generation';
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
    /** The version the ideas were stored at, for Generate Story (KB-186) */
    episode?: { id: string; version: number };
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

  const { commit, run } = await runStage(
    ideationStage,
    ctx,
    target,
    stageRunDeps(),
  );
  const orchestratorSteps = run.diagnostics?.orchestratorSteps as
    | number
    | undefined;

  if (commit.status === 'skipped') {
    console.warn(`[Story Ideation] Ideas not stored: ${commit.reason}`);
  }

  return {
    success: true,
    data: {
      ideas: commit.data.ideas,
      episode: commit.data.episode,
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
