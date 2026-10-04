/**
 * The `screenplay_refinement` stage (FILM-1901): the user's feedback,
 * applied to the stored screenplay. One part, the whole screenplay, as the
 * `screenplay-refinement` job runs today; a scene-scoped target is
 * FILM-1909's.
 *
 * Commit owns what `handlers/screenplay-refinement.ts` wrote:
 * episodes.screenplay_data (scenes and metadata replaced, lastRefinedAt),
 * episodes.metadata (previous_screenplay_data, refinement_history), the
 * dialogue_lines rebuild and the generation_jobs bookkeeping.
 */
import { z } from 'zod';

import screenplayRefinement from '@kit/prompt-engine/prompts/story-generation/screenplay-refinement.json';
import {
  DialogueLineSchema,
  SceneSchema,
  ScreenplayMetadataSchema,
} from '@kit/prompt-engine/schemas';
import {
  sanitizeForPrompt,
  sanitizeStrings,
} from '@kit/shared/prompt-sanitiser';
import { whyNoRow } from '@kit/shared/rows';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { applyCommit, eq, is } from '../commit-plan';
import { jobCompletedWrite } from '../jobs';
import { registerStage } from '../registry';
import type {
  Brief,
  CheckError,
  CommitResult,
  Ctx,
  StageDefinition,
} from '../types';
import { ScreenplayAudioCueSchema } from './screenplay';
import { ORIGIN_MERGE, stageOrigin } from './shared';
import {
  characterIdMap,
  dialogueRebuildSteps,
  dialogueRowsFromScenes,
} from './shared/dialogue-lines';
import { memoised } from './shared/memo';
import { checkSceneNumbering, checkScenes } from './shared/scene-checks';

const LOG = '[Screenplay Refinement]';

/** The episode and the user's feedback; the user is `ctx.userId`. */
export const ScreenplayRefinementTargetSchema = z.object({
  episodeId: z.string().uuid(),
  feedback: z.string(),
});
export type ScreenplayRefinementTarget = z.infer<
  typeof ScreenplayRefinementTargetSchema
>;

/**
 * The `screenplay-refinement` prompt's output. Scenes and metadata keep
 * any extra key the model echoes (`action`, say): the handler stored them
 * as returned, and so does commit.
 */
export const ScreenplayRefinementOutputSchema = z.object({
  screenplay: z.object({
    scenes: z.array(
      SceneSchema.extend({
        dialogue: z.array(DialogueLineSchema.passthrough()),
        audioCues: z.array(ScreenplayAudioCueSchema.passthrough()).optional(),
        emotionalPeak: z.string().optional(),
        hookOut: z.string().optional(),
      }).passthrough(),
    ),
    metadata: ScreenplayMetadataSchema.extend({
      totalDialogueLines: z.number().optional(),
    }).passthrough(),
  }),
});
export type ScreenplayRefinementOutput = z.infer<
  typeof ScreenplayRefinementOutputSchema
>;

interface RefinementHistoryEntry {
  timestamp: string;
  feedback: string;
  type: 'screenplay';
  userId: string;
}

export interface ScreenplayRefinementInputs {
  episode: { id: string; title: string; status: string };
  screenplayData: Record<string, unknown>;
  storyText: string;
  metadata: Record<string, unknown>;
  characters: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  charactersContext: string;
  locationsContext: string;
}

export function loadScreenplayRefinementInputs(
  ctx: Ctx,
  target: ScreenplayRefinementTarget,
): Promise<ScreenplayRefinementInputs> {
  return memoised(
    ctx,
    `screenplay_refinement:${target.episodeId}`,
    async () => {
      const { data: episode, error: episodeError } = await ctx.client
        .from('episodes')
        .select(
          `
        id, title, status, screenplay_data, story_data, metadata,
        project:projects(id, account_id)
      `,
        )
        .eq('id', target.episodeId)
        .is('deleted_at', null)
        .single();

      if (episodeError || !episode) {
        throw new Error(whyNoRow(episodeError, 'Episode not found'));
      }

      const screenplayData = episode.screenplay_data as Record<
        string,
        unknown
      > | null;

      if (!screenplayData?.scenes) {
        throw new Error(
          'Episode must have a screenplay before it can be refined',
        );
      }

      const storyData = episode.story_data as Record<string, unknown> | null;

      if (!ctx.episodeContext) {
        throw new Error(
          'screenplay_refinement needs ctx.episodeContext (the episode context loader)',
        );
      }

      const snapshot = await ctx.episodeContext(target.episodeId, {});

      if (!snapshot.characterList || !snapshot.locationList) {
        throw new Error(
          'screenplay_refinement needs characterList and locationList from the episode context loader',
        );
      }

      console.log(
        `${LOG} Context built: ${snapshot.characterList.length} characters, ${snapshot.locationList.length} locations`,
      );

      return {
        episode: {
          id: episode.id,
          title: episode.title,
          status: episode.status,
        },
        screenplayData,
        storyText: (storyData?.fullStory as string) ?? '',
        metadata: (episode.metadata as Record<string, unknown>) ?? {},
        characters: snapshot.characterList,
        locations: snapshot.locationList,
        charactersContext: snapshot.characters,
        locationsContext: snapshot.locations,
      };
    },
  );
}

export interface ScreenplayRefinementCommitData {
  skipped: boolean;
  screenplayData: Record<string, unknown>;
  dialogueLinesCreated: number;
  generatedAt: string;
  episode: { id: string; status: string };
}

export const screenplayRefinementStage: StageDefinition<
  ScreenplayRefinementTarget,
  ScreenplayRefinementOutput,
  ScreenplayRefinementCommitData
> = {
  key: 'screenplay_refinement',
  targetType: 'episode',
  targetSchema: ScreenplayRefinementTargetSchema,
  outputSchema: ScreenplayRefinementOutputSchema,
  jobTracking: {
    jobType: 'screenplay-refinement',
    reference: (target) => ({ type: 'episode', id: target.episodeId }),
  },

  async parts() {
    return [singlePart('screenplay', 'The revised screenplay')];
  },

  async prepare(ctx, target, part): Promise<Brief> {
    const inputs = await loadScreenplayRefinementInputs(ctx, target);

    return buildBrief({
      stage: 'screenplay_refinement',
      part,
      prompt: screenplayRefinement as PromptFile,
      outputSchema: ScreenplayRefinementOutputSchema,
      variables: {
        // Stored text and the user's feedback, defused for the model (KB-101)
        current_screenplay: JSON.stringify(
          sanitizeStrings(inputs.screenplayData),
        ),
        story_text: sanitizeForPrompt(inputs.storyText),
        characters: inputs.charactersContext || 'No characters defined.',
        locations: inputs.locationsContext || 'No locations defined.',
        feedback: sanitizeForPrompt(target.feedback),
      },
      context: {
        episode: inputs.episode,
        feedback: target.feedback,
        currentScreenplay: inputs.screenplayData,
        characters: inputs.characters,
        locations: inputs.locations,
      },
      constraints: {
        characters: inputs.characters.map((c) => c.name),
        locations: inputs.locations.map((l) => l.name),
        newNamesMustBeDeclared: ['metadata.characters', 'metadata.locations'],
        timeOfDay: SceneSchema.shape.timeOfDay.options,
        noEmptyDialogue: true,
        sceneNumbering: 'contiguous from 1',
      },
      targetVersion: null,
      rubricVariables: {
        context_hint: `Episode "${sanitizeForPrompt(inputs.episode.title)}" — revised to: ${sanitizeForPrompt(target.feedback)}`,
      },
    });
  },

  async check(ctx, target, out): Promise<CheckError[]> {
    const inputs = await loadScreenplayRefinementInputs(ctx, target);
    const { scenes, metadata } = out.screenplay;

    return [
      ...checkScenes(scenes, {
        knownCharacters: inputs.characters.map((c) => c.name),
        knownLocations: inputs.locations.map((l) => l.name),
        declaredCharacters: metadata.characters,
        declaredLocations: metadata.locations,
        path: 'screenplay.scenes',
      }),
      ...checkSceneNumbering(scenes, 'screenplay.scenes'),
    ];
  },

  async commit(ctx, run, target, outputs) {
    const output = outputs[0];

    if (!output) {
      throw new Error('screenplay_refinement commit needs one part output');
    }

    const inputs = await loadScreenplayRefinementInputs(ctx, target);
    const refined = output.screenplay;
    const episodeId = target.episodeId;
    const generatedAt = new Date().toISOString();

    // Guard: skip the write if the episode was deleted
    const { data: currentEpisode } = await ctx.client
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', episodeId)
      .single();

    if (!currentEpisode || currentEpisode.deleted_at) {
      console.warn(
        `${LOG} Episode was deleted during refinement. Skipping write.`,
      );
      await applyCommit(ctx, {
        ops: [
          jobCompletedWrite(episodeId, 'screenplay-refinement', {
            skipped: true,
            reason: 'episode-deleted',
          }),
        ],
      });

      return {
        status: 'skipped',
        reason: 'episode-deleted',
        data: {
          skipped: true,
          screenplayData: {},
          dialogueLinesCreated: 0,
          generatedAt,
          episode: { id: episodeId, status: 'draft' },
        },
      } satisfies CommitResult<ScreenplayRefinementCommitData>;
    }

    const updatedScreenplayData = {
      ...inputs.screenplayData,
      scenes: refined.scenes,
      metadata: refined.metadata,
      lastRefinedAt: generatedAt,
    };

    const refinementHistory =
      (inputs.metadata.refinement_history as RefinementHistoryEntry[]) ?? [];

    refinementHistory.push({
      timestamp: generatedAt,
      feedback: target.feedback,
      type: 'screenplay',
      userId: ctx.userId,
    });

    const updatedMetadata = {
      ...inputs.metadata,
      previous_screenplay_data: inputs.screenplayData,
      refinement_history: refinementHistory,
    };

    const update: Record<string, unknown> = {
      screenplay_data: updatedScreenplayData as Json,
      metadata: updatedMetadata as unknown as Json,
      updated_at: generatedAt,
    };

    if (ctx.originColumnsAvailable) {
      update.generation_origin = stageOrigin(
        'screenplay_refinement',
        run.origin,
      );
    }

    const dialogueLines = dialogueRowsFromScenes(
      episodeId,
      refined.scenes,
      characterIdMap(inputs.characters),
      ctx.originColumnsAvailable ? run.origin : undefined,
    );

    // One transaction under a run: the screenplay (its content_revisions
    // snapshot with it), the dialogue rebuild and the job's completion
    const applied = await applyCommit(ctx, {
      ops: [
        {
          key: 'episode',
          op: 'update',
          table: 'episodes',
          values: update,
          ...(ctx.originColumnsAvailable ? { merge: [ORIGIN_MERGE] } : {}),
          match: [eq('id', episodeId), is('deleted_at', null)],
          requireRows: true,
          returning: ['id', 'status'],
        },
        ...dialogueRebuildSteps(episodeId, dialogueLines),
        jobCompletedWrite(episodeId, 'screenplay-refinement', {
          provider: run.usage?.provider,
          model: run.usage?.model,
          tokensUsed: run.usage?.tokens,
          scenesCount: refined.scenes.length,
          dialogueLinesCount: dialogueLines.length,
          feedback: target.feedback.substring(0, 200),
        }),
      ],
    });

    const updatedEpisode = applied.results.episode![0] as {
      id: string;
      status: string;
    };

    console.log(
      `${LOG} Screenplay refined successfully. ${refined.scenes.length} scenes, ${dialogueLines.length} dialogue lines`,
    );

    return {
      status: 'committed',
      data: {
        skipped: false,
        screenplayData: updatedScreenplayData,
        dialogueLinesCreated: dialogueLines.length,
        generatedAt,
        episode: { id: updatedEpisode.id, status: updatedEpisode.status },
      },
    };
  },
};

registerStage(screenplayRefinementStage);
