import { defineStageWriter } from '@kit/ai-gateway';
import {
  type Ctx,
  type ScreenplayBriefContext,
  type ScreenplayPartOutput,
  type ScreenplayScene,
  screenplayStage,
  splitScreenplayIntoParts,
} from '@kit/generation';

import { sanitizeStrings } from '../../lib';

/**
 * The Screenplay Orchestrator writes every scene in one pass on the first
 * brief; its scenes are laid across the stage's per-scene parts and served
 * from there after.
 */
export const screenplayStageWriter = defineStageWriter(
  screenplayStage,
  (run, { ctx }) => {
    let partOutputs: ScreenplayPartOutput[] | undefined;

    return async (brief) => {
      if (!partOutputs) {
        const context = brief.context as unknown as ScreenplayBriefContext;
        const scenes = await writeScreenplay(context, {
          episodeId: context.episode.id,
          projectId: run.projectId ?? context.project.id ?? '',
          accountId: ctx.accountId,
          userId: ctx.userId,
          supabase: ctx.client,
        });

        partOutputs = splitScreenplayIntoParts(scenes, brief.part.total, {
          characters: context.characters.map((c) => c.name),
          locations: context.locations.map((l) => l.name),
        });
      }

      return { output: partOutputs[brief.part.index] ?? { scenes: [] } };
    };
  },
);

/**
 * The orchestrator over the brief's context, then the advisory continuity
 * checkpoint and quality evaluation (both log only).
 */
async function writeScreenplay(
  context: ScreenplayBriefContext,
  job: {
    episodeId: string;
    projectId: string;
    accountId: string;
    userId: string;
    supabase: Ctx['client'];
  },
): Promise<ScreenplayScene[]> {
  const { runScreenplayOrchestrator } = await import(
    '../screenplay-orchestrator'
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
      '../../lib/canon/validation-checkpoint'
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
        supabase: job.supabase,
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
