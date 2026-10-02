/**
 * The `story` stage (FILM-1901): one part, the episode's story.
 *
 * prepare renders `story-generation` with the variables the Story Director
 * renders for its first call, and carries the Story Orchestrator's input in
 * the brief's context. commit owns what the worker's handler wrote:
 * `episodes.story_data`, status `story`, the duration, the job's
 * bookkeeping, the canon tables, and the character and location assets the
 * story invented. The canon facts (`canonFacts`) are part of the output: in
 * server mode the worker's generate step extracts them with the
 * `canon-extraction` prompt, in external mode the agent submits them, and
 * commit stores them without a model call either way (criterion 9).
 */
import { z } from 'zod';

import { ProjectTypeSchema } from '@kit/film-studio-schemas/project';
import storyGeneration from '@kit/prompt-engine/prompts/story-generation/story-generation.json';
import { StorySchema } from '@kit/prompt-engine/schemas';
import {
  type ContentStyle,
  calculateContentScaling,
} from '@kit/shared/duration-scaling';
import {
  sanitizeForPrompt,
  sanitizeStrings,
} from '@kit/shared/prompt-sanitiser';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { CanonExtractionSchema, commitStoryCanon } from '../canon';
import { markJobCompleted } from '../jobs';
import { registerStage } from '../registry';
import type {
  Brief,
  CheckError,
  CommitResult,
  Ctx,
  StageDefinition,
} from '../types';
import {
  ASSET_NAME_MAX,
  checkError,
  directionNotes,
  loadEpisodeContext,
  projectAssetNames,
  projectTypeOf,
  readEpisode,
  seasonLine,
  uuid,
} from './shared';

const ContentStyleSchema = z.enum([
  'dialogue-heavy',
  'balanced',
  'action-heavy',
]);

export const StoryTargetSchema = z.object({
  episodeId: uuid,
  projectId: uuid,
  title: z.string().min(1),
  logline: z.string(),
  targetDuration: z.number().positive().default(300),
  contentStyle: ContentStyleSchema.default('dialogue-heavy'),
  threadCandidates: z
    .array(
      z.object({
        threadId: z.string(),
        threadName: z.string(),
        action: z.enum(['progress', 'resolve']),
      }),
    )
    .optional(),
  themes: z.array(z.string()).optional(),
  hook: z.string().optional(),
  visualDirection: z.string().optional(),
});

export type StoryTarget = z.infer<typeof StoryTargetSchema>;

export const NewCharacterSchema = z.object({
  name: z.string().min(1).max(ASSET_NAME_MAX),
  role: z.string(),
  arc: z.string().optional(),
  description: z.string(),
  physicalDescription: z.string().optional(),
  clothingStyle: z.string().optional(),
  mannerisms: z.string().optional(),
});

export const NewLocationSchema = z.object({
  name: z.string().min(1).max(ASSET_NAME_MAX),
  setting: z.string().optional(),
  description: z.string(),
  visualDescription: z.string().optional(),
});

/**
 * The prompt's own output, with its `sentimentScore` normalisation, plus
 * the invented assets, the canon facts and the server evaluation.
 */
export const StoryStageOutputSchema = z.object({
  story: StorySchema.extend({
    title: z.string().min(1),
    fullText: z.string().min(1),
    sentimentScore: z
      .number()
      .transform((v) => (v > 1 ? v / 10 : v))
      .pipe(z.number().min(0).max(1)),
    viralStructure: z.record(z.unknown()).optional(),
    factReferences: z
      .array(
        z.object({
          factId: z.string(),
          sceneDescription: z.string(),
          howPresented: z.string(),
        }),
      )
      .optional(),
  }),
  newCharacters: z.array(NewCharacterSchema).default([]),
  newLocations: z.array(NewLocationSchema).default([]),
  /** From `canon-extraction` (server) or the agent (external); optional */
  canonFacts: CanonExtractionSchema.optional(),
  /** The server orchestrator's evaluation; absent in external mode */
  evaluation: z
    .object({
      viralQuality: z.record(z.unknown()).optional(),
      orchestratorSteps: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type StoryStageOutput = z.infer<typeof StoryStageOutputSchema>;

/** The Story Orchestrator's input, as the brief's context carries it. */
export const StoryBriefContextSchema = z.object({
  episodeTitle: z.string(),
  episodeLogline: z.string(),
  genre: z.string(),
  targetAudience: z.string(),
  targetDurationSeconds: z.number(),
  contentStyle: ContentStyleSchema,
  episodeNumber: z.number(),
  contentType: ProjectTypeSchema.optional(),
  charactersContext: z.string(),
  locationsContext: z.string(),
  seasonContext: z.string().optional(),
  previousEpisodesContext: z.string().optional(),
  visualStyle: z.string().optional(),
  verifiedFacts: z.string().optional(),
  recurringElementsContext: z.string().optional(),
  threadCandidatesContext: z.string().optional(),
  ideationThemes: z.array(z.string()).optional(),
  ideationHook: z.string().optional(),
  visualDirection: z.string().optional(),
});

export type StoryBriefContext = z.infer<typeof StoryBriefContextSchema>;

export function storyOrchestratorInput(brief: Brief): StoryBriefContext {
  return StoryBriefContextSchema.parse(brief.context.orchestrator);
}

export interface StoryCommitData {
  episode: { id: string; status: string; version: number };
  storyData: Record<string, unknown>;
  generatedAt: string;
  /** Child runs for FILM-1903 to open: a description per created asset */
  followOn: Array<{ stage: 'asset_description'; target: { assetId: string } }>;
}

const SKIPPED_EPISODE = { id: '', status: 'draft', version: 0 };

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const storyStage: StageDefinition<
  StoryTarget,
  StoryStageOutput,
  StoryCommitData
> = {
  key: 'story',
  targetType: 'episode',
  targetSchema: StoryTargetSchema,
  outputSchema: StoryStageOutputSchema,
  jobTracking: {
    jobType: 'story',
    reference: (target) => ({ type: 'episode', id: target.episodeId }),
  },

  async parts() {
    return [singlePart('story', 'The episode story')];
  },

  async prepare(ctx, target, part) {
    const snapshot = await loadEpisodeContext(ctx, target.episodeId, {
      semanticQuery: [target.title, target.logline].filter(Boolean).join('\n'),
    });
    const episode = await readEpisode(ctx.client, target.episodeId);

    const scaling = calculateContentScaling({
      targetDurationSeconds: target.targetDuration,
      contentStyle: target.contentStyle,
    });

    const threadCandidatesContext = target.threadCandidates?.length
      ? target.threadCandidates
          .map(
            (t) =>
              `- ${t.action.toUpperCase()}: "${sanitizeForPrompt(t.threadName)}"`,
          )
          .join('\n')
      : undefined;

    const seasonContext = seasonLine(snapshot) + directionNotes(snapshot);
    const genre = snapshot.genre ?? 'general';
    const targetAudience = snapshot.targetAudience ?? 'general';

    // Payload text is the user's: defused before the model sees it (KB-101)
    const orchestrator: StoryBriefContext = {
      episodeTitle: sanitizeForPrompt(target.title),
      episodeLogline: sanitizeForPrompt(target.logline),
      genre,
      targetAudience,
      targetDurationSeconds: target.targetDuration,
      contentStyle: target.contentStyle,
      episodeNumber: snapshot.episodeNumber ?? 1,
      contentType: projectTypeOf(snapshot),
      charactersContext: snapshot.characters,
      locationsContext: snapshot.locations,
      seasonContext,
      previousEpisodesContext: snapshot.previousEpisodes,
      visualStyle: snapshot.visualStyle,
      verifiedFacts: snapshot.episodeFacts || undefined,
      recurringElementsContext: snapshot.recurringElements,
      threadCandidatesContext,
      ...sanitizeStrings({
        ideationThemes: target.themes,
        ideationHook: target.hook,
        visualDirection: target.visualDirection,
      }),
    };

    // The variables the Story Director renders for its first call
    const variables = {
      title: orchestrator.episodeTitle,
      logline: orchestrator.episodeLogline,
      premise: orchestrator.episodeLogline,
      genre,
      target_audience: targetAudience,
      target_duration: target.targetDuration,
      duration_description: `${Math.round(target.targetDuration / 60)} minutes`,
      word_count_min: scaling.story.wordCountMin,
      word_count_max: scaling.story.wordCountMax,
      estimated_scene_count_min: scaling.screenplay.sceneCountMin,
      estimated_scene_count_max: scaling.screenplay.sceneCountMax,
      content_style: target.contentStyle,
      characters: snapshot.characters,
      locations: snapshot.locations,
      season_context: seasonContext,
      previous_episodes: snapshot.previousEpisodes,
      visual_style: snapshot.visualStyle ?? '',
      recurring_element: snapshot.recurringElements ?? '',
      canon_context: '',
      plot_beats: '',
      ideation_themes: orchestrator.ideationThemes?.join(', ') ?? '',
      ideation_hook: orchestrator.ideationHook ?? '',
      visual_direction: orchestrator.visualDirection ?? '',
      viral_goals: '',
      verified_facts: snapshot.episodeFacts ?? '',
    };

    return buildBrief({
      stage: 'story',
      part,
      prompt: storyGeneration as PromptFile,
      variables,
      context: {
        orchestrator,
        episode: {
          id: target.episodeId,
          number: snapshot.episodeNumber,
          characterNames: snapshot.characterNames ?? [],
          locationNames: snapshot.locationNames ?? [],
        },
        project: { id: target.projectId },
      },
      outputSchema: StoryStageOutputSchema,
      constraints: {
        wordCount: {
          min: scaling.story.wordCountMin,
          max: scaling.story.wordCountMax,
          rejectedBelow: Math.floor(scaling.story.wordCountMin / 2),
        },
        sceneCount: {
          min: scaling.screenplay.sceneCountMin,
          max: scaling.screenplay.sceneCountMax,
        },
        characters:
          'every story.characters[].name is a character of the project, or is listed in newCharacters to be created',
        assetNameMax: ASSET_NAME_MAX,
        canonFacts:
          'optional; when present, threads and the episode memory are stored from it without a model call',
      },
      targetVersion: episode?.version ?? null,
      rubricVariables: {
        title: orchestrator.episodeTitle,
        genre,
        target_audience: targetAudience,
        target_duration: target.targetDuration,
      },
    });
  },

  async check(ctx, target, out) {
    const errors: CheckError[] = [];
    const scaling = calculateContentScaling({
      targetDurationSeconds: target.targetDuration,
      contentStyle: target.contentStyle as ContentStyle,
    });

    const words = wordCount(out.story.fullText);
    const floor = Math.floor(scaling.story.wordCountMin / 2);

    if (words < floor) {
      errors.push(
        checkError(
          'story.fullText',
          'too_short',
          `${words} words; the brief asked for ${scaling.story.wordCountMin}-${scaling.story.wordCountMax}`,
        ),
      );
    }

    const known = await projectAssetNames(
      ctx.client,
      target.projectId,
      'character',
    );

    if (known.size > 0) {
      for (const invented of out.newCharacters) {
        known.add(invented.name.toLowerCase());
      }

      out.story.characters.forEach((character, index) => {
        if (!known.has(character.name.toLowerCase())) {
          errors.push(
            checkError(
              `story.characters.${index}.name`,
              'unknown_character',
              `"${character.name}" is not a character of this project; use an existing character or list it in newCharacters`,
            ),
          );
        }
      });
    }

    return errors;
  },

  async commit(ctx, run, target, outputs) {
    const out = outputs[0]!;
    const client = ctx.client;
    const generatedAt = new Date().toISOString();
    const isServer = run.mode === 'server';

    // Skip the write if the episode was deleted during generation
    const current = await readEpisode(client, target.episodeId);

    if (!current || current.deleted_at) {
      ctx.log?.(
        '[story] Episode was deleted during generation. Skipping write.',
      );

      if (isServer) {
        await markJobCompleted(client, target.episodeId, 'story', {
          skipped: true,
          reason: 'episode-deleted',
        });
      }

      return skipped('episode-deleted', target, generatedAt);
    }

    // A server job the user cancelled has no active row; write nothing
    if (isServer) {
      const { data: activeJob } = await client
        .from('generation_jobs')
        .select('status')
        .eq('reference_type', 'episode')
        .eq('reference_id', target.episodeId)
        .eq('job_type', 'story')
        .in('status', ['queued', 'processing'])
        .limit(1)
        .maybeSingle();

      if (!activeJob) {
        ctx.log?.(
          '[story] No active generation job found (may have been cancelled). Skipping write.',
        );
        return skipped('job-cancelled', target, generatedAt);
      }
    }

    // The context the handler stored beside the story; external mode commits
    // in a later request than prepare, so it is loaded again here
    const snapshot = await loadEpisodeContext(ctx, target.episodeId);

    const viralQuality = out.evaluation?.viralQuality;
    const viralScore =
      typeof viralQuality?.overallScore === 'number'
        ? viralQuality.overallScore
        : undefined;

    const storyData = {
      premise: target.logline,
      fullStory: out.story.fullText,
      generatedAt,
      generatedBy: {
        mode: isServer ? 'agentic' : 'external',
        orchestratorSteps: out.evaluation?.orchestratorSteps,
        viralScore,
      },
      title: target.title,
      targetDuration: target.targetDuration,
      contentStyle: target.contentStyle,
      genre: snapshot.genre,
      targetAudience: snapshot.targetAudience,
      videoStyle: snapshot.visualStyle,
      actBreakdown: out.story.actBreakdown,
      characters: out.story.characters,
      themes: out.story.themes,
      tone: out.story.tone,
      estimatedSceneCount: out.story.estimatedSceneCount,
      episodeSummary: out.story.episodeSummary,
      sentimentScore: out.story.sentimentScore,
      keyEvents: out.story.keyEvents,
      viralStructure: out.story.viralStructure,
      viralQuality,
    };

    const { data: updatedEpisode, error: updateError } = await client
      .from('episodes')
      .update({
        story_data: storyData as Json,
        status: 'story',
        target_duration_seconds: target.targetDuration,
        updated_at: generatedAt,
      })
      .eq('id', target.episodeId)
      // No .eq('version', ...): the orchestrator writes viral_quality mid-run,
      // which bumps the version through the trigger (see f64c9648)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode not found or was deleted');
    }

    if (isServer) {
      await markJobCompleted(client, target.episodeId, 'story', {
        mode: 'agentic-stage1',
        orchestratorSteps: out.evaluation?.orchestratorSteps,
        viralScore,
      });
    }

    // Canon tables (non-fatal)
    try {
      await commitStoryCanon({
        projectId: target.projectId,
        episodeId: target.episodeId,
        episodeNumber: snapshot.episodeNumber ?? 1,
        season: snapshot.seasonNumber ?? 1,
        keyEvents: out.story.keyEvents ?? [],
        characters: out.story.characters ?? [],
        episodeSummary: out.story.episodeSummary,
        themes: out.story.themes,
        extraction: out.canonFacts ?? null,
        createdBy: ctx.userId,
        supabase: client,
      });
    } catch (canonError) {
      console.warn('[story] Canon commit failed (non-fatal):', canonError);
    }

    // Assets for the characters and locations the story invented (non-fatal)
    let createdAssetIds: string[] = [];
    try {
      createdAssetIds = await autoCreateNewAssets(ctx, target, out);
    } catch (assetError) {
      console.warn(
        '[story] Auto-create assets failed (non-fatal):',
        assetError,
      );
    }

    return {
      status: 'committed',
      data: {
        episode: {
          id: updatedEpisode.id,
          status: updatedEpisode.status,
          version: updatedEpisode.version,
        },
        storyData,
        generatedAt,
        followOn: createdAssetIds.map((assetId) => ({
          stage: 'asset_description' as const,
          target: { assetId },
        })),
      },
    };
  },
};

function skipped(
  reason: string,
  target: StoryTarget,
  generatedAt: string,
): CommitResult<StoryCommitData> {
  return {
    status: 'skipped',
    reason,
    data: {
      episode: { ...SKIPPED_EPISODE, id: target.episodeId },
      storyData: {},
      generatedAt,
      followOn: [],
    },
  };
}

/**
 * Auto-create character and location assets from LLM-invented entities.
 * Uses upsert semantics (ON CONFLICT DO NOTHING) to avoid duplicates.
 * Tags newly created asset IDs onto the episode's metadata.
 */
async function autoCreateNewAssets(
  ctx: Ctx,
  target: StoryTarget,
  out: StoryStageOutput,
): Promise<string[]> {
  const { newCharacters, newLocations } = out;
  const client = ctx.client;

  if (newCharacters.length === 0 && newLocations.length === 0) return [];

  const createdIds: string[] = [];

  if (newCharacters.length > 0) {
    const charRows = newCharacters.map((char) => ({
      project_id: target.projectId,
      type: 'character' as const,
      name: char.name,
      description: char.description,
      metadata: {
        role: char.role,
        personality: char.description,
        physicalAttributes: char.physicalDescription
          ? { rawDescription: char.physicalDescription }
          : undefined,
        clothingStyle: char.clothingStyle
          ? { rawDescription: char.clothingStyle }
          : undefined,
        mannerisms: char.mannerisms,
        autoCreated: true,
      },
    }));

    const { data: inserted } = await client
      .from('assets')
      .upsert(charRows, {
        onConflict: 'project_id,type,name',
        ignoreDuplicates: true,
      })
      .select('id');

    if (inserted) {
      createdIds.push(...inserted.map((r: { id: string }) => r.id));
      console.log(`[story] Auto-created ${inserted.length} character assets`);
    }
  }

  if (newLocations.length > 0) {
    const locRows = newLocations.map((loc) => ({
      project_id: target.projectId,
      type: 'location' as const,
      name: loc.name,
      description: loc.description,
      metadata: {
        setting: loc.setting,
        visualDescription: loc.visualDescription,
        autoCreated: true,
      },
    }));

    const { data: inserted } = await client
      .from('assets')
      .upsert(locRows, {
        onConflict: 'project_id,type,name',
        ignoreDuplicates: true,
      })
      .select('id');

    if (inserted) {
      createdIds.push(...inserted.map((r: { id: string }) => r.id));
      console.log(`[story] Auto-created ${inserted.length} location assets`);
    }
  }

  if (createdIds.length > 0) {
    const { data: episode } = await client
      .from('episodes')
      .select('metadata')
      .eq('id', target.episodeId)
      .single();

    if (episode) {
      const metadata = (episode.metadata ?? {}) as Record<string, unknown>;
      const existingCharIds = (metadata.character_ids ?? []) as string[];
      const existingLocIds = (metadata.location_ids ?? []) as string[];

      const allIds = [
        ...new Set([...existingCharIds, ...existingLocIds, ...createdIds]),
      ];

      const { data: tagged } = await client
        .from('episodes')
        .update({
          metadata: {
            ...metadata,
            character_ids: allIds.filter((id) =>
              [
                ...existingCharIds,
                ...createdIds.slice(0, newCharacters.length),
              ].includes(id),
            ),
            location_ids: allIds.filter((id) =>
              [
                ...existingLocIds,
                ...createdIds.slice(newCharacters.length),
              ].includes(id),
            ),
          },
        })
        .eq('id', target.episodeId)
        .select('id');

      // RLS filters a refused update to no rows, without an error (KB-105)
      if (!tagged?.length) {
        console.warn('[story] The new assets were not tagged on the episode');
      }
    }
  }

  return createdIds;
}

registerStage(storyStage);
