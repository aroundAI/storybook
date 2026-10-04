/**
 * Screenplay Conversion Handler
 *
 * Converts a story to screenplay format and extracts dialogue lines. The
 * work is the `screenplay` stage of `@kit/generation` (FILM-1901): prepare
 * reads the episode and builds the brief, `run.write` reaches the stage's
 * writer (`@kit/episodes/agent/stage-writers`), whose Screenplay
 * Orchestrator writes every scene in one pass (laid across the per-scene
 * parts), each part is checked against the stage's schema, and commit saves
 * `screenplay_data`, moves the episode to `storyboard`, rebuilds the
 * dialogue_lines and closes the generation_jobs row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type ScreenplayScene,
  runStage,
  screenplayStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface ScreenplayConversionResult {
  success: boolean;
  data: {
    screenplay: {
      title: string;
      scenes: ScreenplayScene[];
      totalDialogueLines: number;
      estimatedDuration: number;
    };
    dialogueLinesCreated: number;
    episode: {
      id: string;
      status: string;
      version: number;
    };
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
    };
  };
}

export async function processScreenplayConversion(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<ScreenplayConversionResult> {
  const data = parseLlmJobPayload('screenplay-conversion', payload);

  console.log(
    `[Screenplay Conversion] Processing for episode ${data.episodeId}`,
  );

  const { commit } = await runStage(
    screenplayStage,
    workerCtx(supabase, data),
    {
      episodeId: data.episodeId,
      contentStyle: data.contentStyle,
      dialogueStyle: data.dialogueStyle,
    },
    stageRunDeps(),
  );

  const costCents = 0; // Agent orchestrator tracks cost internally

  if (commit.status === 'skipped') {
    return {
      success: true,
      data: {
        screenplay: {
          title: commit.data.episodeTitle,
          scenes: [],
          totalDialogueLines: 0,
          estimatedDuration: 0,
        },
        dialogueLinesCreated: 0,
        episode: commit.data.episode,
        metadata: {
          provider: 'skipped',
          model: 'skipped',
          costCents: 0,
          tokensUsed: 0,
          generatedAt: new Date().toISOString(),
        },
      },
    };
  }

  return {
    success: true,
    data: {
      screenplay: {
        title: commit.data.episodeTitle,
        scenes: commit.data.scenes,
        totalDialogueLines: commit.data.dialogueLinesCreated,
        estimatedDuration: commit.data.totalEstimatedDuration,
      },
      dialogueLinesCreated: commit.data.dialogueLinesCreated,
      episode: commit.data.episode,
      metadata: {
        provider: 'multi-agent',
        model: 'screenplay-orchestrator',
        costCents,
        tokensUsed: 0,
        generatedAt: commit.data.generatedAt,
      },
    },
  };
}
