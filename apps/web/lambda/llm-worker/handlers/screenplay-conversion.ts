/**
 * Screenplay Conversion Handler
 *
 * Converts a story to screenplay format and extracts dialogue lines. The
 * work is the `screenplay` stage of `@kit/generation` (FILM-1901): prepare
 * reads the episode and builds the brief, the Screenplay Orchestrator
 * writes every scene in one pass (laid across the stage's per-scene parts),
 * each part is checked against the stage's schema, and commit saves
 * `screenplay_data`, moves the episode to `storyboard`, rebuilds the
 * dialogue_lines and closes the generation_jobs row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeStrings } from '@kit/episodes/lib';
import {
  type Brief,
  type GenerateResult,
  type ScreenplayBriefContext,
  type ScreenplayPartOutput,
  type ScreenplayScene,
  runStage,
  screenplayStage,
  splitScreenplayIntoParts,
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

  // The orchestrator writes the whole screenplay at once; its scenes are
  // laid across the parts on the first call and served from there after.
  let partOutputs: ScreenplayPartOutput[] | undefined;

  const generate = async (brief: Brief): Promise<GenerateResult> => {
    if (!partOutputs) {
      const context = brief.context as unknown as ScreenplayBriefContext;
      const scenes = await writeScreenplay(context, data, supabase);

      partOutputs = splitScreenplayIntoParts(scenes, brief.part.total, {
        characters: context.characters.map((c) => c.name),
        locations: context.locations.map((l) => l.name),
      });
    }

    return { output: partOutputs[brief.part.index] ?? { scenes: [] } };
  };

  const { commit } = await runStage(
    screenplayStage,
    workerCtx(supabase, data),
    {
      episodeId: data.episodeId,
      contentStyle: data.contentStyle,
      dialogueStyle: data.dialogueStyle,
    },
    // The orchestrator writes; the run supplies the id, the TARGET_CHANGED
    // check and the origin the commit stamps (FILM-1903)
    { ...stageRunDeps(), generate },
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

/**
 * The server writer: the Screenplay Orchestrator over the brief's context,
 * then the advisory continuity checkpoint and quality evaluation (both log
 * only). Returns the scenes for the stage to check and commit.
 */
async function writeScreenplay(
  context: ScreenplayBriefContext,
  job: {
    episodeId: string;
    projectId: string;
    accountId: string;
    userId: string;
  },
  supabase: SupabaseClient<Database>,
): Promise<ScreenplayScene[]> {
  const { runScreenplayOrchestrator } = await import(
    '@kit/episodes/agent/screenplay-orchestrator'
  );

  const orchestratorResult = await runScreenplayOrchestrator({
    episodeId: job.episodeId,
    episodeTitle: context.promptTitle,
    episodeNumber: context.episode.number,
    genre: context.project.genre,
    targetAudience: context.project.targetAudience,
    targetDurationSeconds: context.targetDurationSeconds,
    contentStyle: context.contentStyle,
    accountId: job.accountId,
    storyText: context.storyText,
    charactersContext: context.charactersContext || 'No characters defined.',
    characterNames: context.characterNames,
    locationNames: context.locationNames,
    recurringElementsContext: context.recurringElementsContext,
    sceneCountMin: context.scaling.sceneCountMin,
    sceneCountMax: context.scaling.sceneCountMax,
    dialogueLinesPerSceneMin: context.scaling.dialogueLinesPerSceneMin,
    dialogueLinesPerSceneMax: context.scaling.dialogueLinesPerSceneMax,
    actBreakdown: context.actBreakdown,
    tone: context.tone,
    themes: context.themes,
    keyEvents: context.keyEvents,
    directionNotes: context.directionNotes,
  });

  if (!orchestratorResult.success || orchestratorResult.scenes.length === 0) {
    throw new Error(
      `Screenplay Orchestrator failed: ${orchestratorResult.error ?? 'No scenes generated'}`,
    );
  }

  const scenes = orchestratorResult.scenes as ScreenplayScene[];

  // FILM-1104: SCREENPLAY validation checkpoint (warn, don't block)
  try {
    const { runValidationCheckpoint } = await import(
      '../utils/validation-checkpoint'
    );

    const sceneBlocks = scenes.map((scene) => ({
      sceneNumber: scene.number,
      content: `${scene.heading}\n${scene.description}\n${scene.action?.join('\n') ?? ''}`,
    }));

    const validation = await runValidationCheckpoint(
      {
        checkpoint: 'SCREENPLAY',
        enforcement: 'flexible',
        projectId: job.projectId,
        episodeNumber: context.episode.number,
        supabase,
      },
      { sceneBlocks },
    );

    if (validation.messages.length > 0) {
      console.log(
        `[Screenplay Conversion] Continuity validation: ${validation.messages.join(' | ')}`,
      );
    }
  } catch (err) {
    console.warn('[Screenplay Conversion] Validation checkpoint skipped:', err);
  }

  // SCREENPLAY quality evaluation (non-blocking, advisory)
  try {
    const { executeLLM } = await import('@kit/ai-gateway');

    // Model output from this run, going back to a model
    const screenplayText = sanitizeStrings(scenes)
      .map(
        (scene) =>
          `${scene.heading}\n${scene.description}\n${(scene.action ?? []).join('\n')}`,
      )
      .join('\n\n');

    const minutes = Math.round(context.targetDurationSeconds / 60);
    const targetSceneRange = `${context.scaling.sceneCountMin}-${context.scaling.sceneCountMax} scenes for ${minutes} minutes`;

    const qualityResult = await executeLLM<{
      overallScore: number;
      dimensions: Record<string, number>;
      critique: string;
      revisionPriority: string;
    }>({
      templateSlug: 'quality-evaluation/screenplay-quality',
      variables: {
        screenplay_content: screenplayText,
        context_hint: `Episode "${context.promptTitle}" — target: ${minutes} minutes, genre: ${context.project.genre}`,
        target_scene_count: targetSceneRange,
      },
      context: {
        name: 'screenplay-quality-eval',
        accountId: job.accountId,
        userId: job.userId,
      },
    });

    const score = qualityResult.data?.overallScore ?? 0;
    console.log(
      `[Screenplay Conversion] Quality score: ${score.toFixed(2)} — ${qualityResult.data?.critique ?? 'No critique'}`,
    );

    if (score < 0.65) {
      console.warn(
        `[Screenplay Conversion] Low quality score (${score.toFixed(2)}). Revision priority: ${qualityResult.data?.revisionPriority ?? 'N/A'}`,
      );
    }
  } catch (err) {
    console.warn(
      '[Screenplay Conversion] Quality evaluation skipped:',
      err instanceof Error ? err.message : err,
    );
  }

  return scenes;
}
