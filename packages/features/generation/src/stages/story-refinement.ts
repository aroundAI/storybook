/**
 * story_refinement: revise an episode's story from the user's feedback.
 *
 * Target: the episode and the feedback. Commit: `episodes.story_data`
 * (the refined fields over the stored ones), `metadata.previous_story_data`
 * (the undo copy) and `metadata.refinement_history`, plus the
 * generation_jobs row the web app queued. Moved out of the LLM worker's
 * `handlers/story-refinement.ts` (FILM-1901); the parity fixture in
 * `apps/web/lambda/llm-worker/__tests__/fixtures/parity/` is what it wrote.
 */
import { z } from 'zod';

import storyRefinementPrompt from '@kit/prompt-engine/prompts/story-generation/story-refinement.json';
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
  CheckError,
  CommitResult,
  Ctx,
  GenerationRun,
  PartSpec,
  StageDefinition,
} from '../types';

const PROMPT = storyRefinementPrompt as PromptFile;

export const StoryRefinementTargetSchema = z.object({
  episodeId: z.string().uuid(),
  feedback: z.string().min(1),
});

export type StoryRefinementTarget = z.infer<typeof StoryRefinementTargetSchema>;

/**
 * The prompt's `output.schema` says every story field is required; the
 * handler took each one with a fallback to the stored value, so a field the
 * model leaves out keeps what the episode had. The schema keeps that: a
 * present field must have the right type, an absent one is allowed.
 * `role` is a string, not the prompt's three-value enum: the stored
 * stories carry other roles and the handler never refused them.
 */
const RefinedStorySchema = z.object({
  title: z.string().optional(),
  fullText: z.string().min(1),
  actBreakdown: z
    .object({ act1: z.string(), act2: z.string(), act3: z.string() })
    .passthrough()
    .optional(),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string(),
        arc: z.string().optional(),
      }),
    )
    .optional(),
  themes: z.array(z.string()).optional(),
  tone: z.string().optional(),
  estimatedSceneCount: z.number().optional(),
  episodeSummary: z.string().optional(),
  sentimentScore: z
    .number()
    .transform((v) => (v > 1 ? v / 10 : v))
    .pipe(z.number().min(0).max(1))
    .optional(),
  keyEvents: z.array(z.string()).optional(),
  viralStructure: z
    .object({
      openingHook: z.string().optional(),
      curiosityGap: z.string().optional(),
      emotionalArc: z.array(z.string()).optional(),
      setupPayoffPair: z
        .object({ setup: z.string(), payoff: z.string() })
        .optional(),
      loopBeat: z.string().optional(),
      memorableScene: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export const StoryRefinementOutputSchema = z.object({
  story: RefinedStorySchema,
  newCharacters: z
    .array(
      z.object({ name: z.string(), role: z.string(), description: z.string() }),
    )
    .optional(),
  newLocations: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .optional(),
});

export type StoryRefinementOutput = z.output<
  typeof StoryRefinementOutputSchema
>;

export interface StoryRefinementData {
  story: Record<string, unknown>;
  episode: { id: string; status: string };
}

interface RefinementHistoryEntry {
  timestamp: string;
  feedback: string;
  type: 'story';
  userId: string;
}

const JOB_TYPE = 'story-refinement';

async function loadEpisode(ctx: Ctx, episodeId: string) {
  const { data: episode, error } = await ctx.client
    .from('episodes')
    .select('id, title, status, story_data, metadata, version')
    .eq('id', episodeId)
    .is('deleted_at', null)
    .single();

  if (error || !episode) {
    throw new Error(whyNoRow(error, 'Episode not found'));
  }

  return episode;
}

function storyOf(storyData: unknown): Record<string, unknown> {
  const story = storyData as Record<string, unknown> | null;

  if (!story?.fullStory) {
    throw new Error('Episode must have a story before it can be refined');
  }

  return story;
}

async function parts(): Promise<PartSpec[]> {
  return [singlePart('story', 'The refined story')];
}

async function prepare(
  ctx: Ctx,
  target: StoryRefinementTarget,
  part: PartSpec,
) {
  const episode = await loadEpisode(ctx, target.episodeId);
  const storyData = storyOf(episode.story_data);

  if (!ctx.episodeContext) {
    throw new Error(
      'story_refinement needs ctx.episodeContext: the caller supplies the episode context loader',
    );
  }

  const world = await ctx.episodeContext(target.episodeId, {
    semanticQuery: [episode.title, storyData.episodeSummary]
      .filter((p): p is string => typeof p === 'string' && !!p)
      .join('\n'),
  });

  const seasonContext = world.seasonPremise
    ? `This is Episode ${world.episodeNumber}${world.seasonNumber ? ` of Season ${world.seasonNumber}` : ''}. Season Premise: ${world.seasonPremise}`
    : '';
  const directionNotes = world.seasonDirectionNotes
    ? `\n\n## SEASON CREATIVE DIRECTION (apply to this episode):\n${world.seasonDirectionNotes}`
    : '';

  ctx.log?.(
    `[Story Refinement] Context built: ${world.counts.characters} characters, ${world.counts.locations} locations`,
  );

  return buildBrief({
    stage: 'story_refinement',
    part,
    prompt: PROMPT,
    variables: {
      // The stored story and the user's feedback, defused for the model;
      // storyData itself stays as stored (it is the undo copy) (KB-101)
      current_story: JSON.stringify(sanitizeStrings(storyData)),
      characters: world.characters || 'No characters defined.',
      locations: world.locations || 'No locations defined.',
      feedback: sanitizeForPrompt(target.feedback),
      season_context: seasonContext + directionNotes,
      previous_episodes: world.previousEpisodes,
    },
    context: {
      episode: {
        id: episode.id,
        title: episode.title,
        status: episode.status,
        version: episode.version,
      },
      currentStory: storyData,
      feedback: target.feedback,
      characters: world.characters,
      locations: world.locations,
      previousEpisodes: world.previousEpisodes,
      seasonContext: seasonContext + directionNotes,
    },
    outputSchema: StoryRefinementOutputSchema,
    constraints: {
      fullText: 'required, not blank',
      sentimentScore: 'between 0 and 1',
      estimatedSceneCount: 'at least 1 when given',
      unchangedFields: 'a field left out keeps the stored value',
    },
    targetVersion: episode.version,
    rubricVariables: { title: episode.title },
  });
}

async function check(
  _ctx: Ctx,
  _target: StoryRefinementTarget,
  out: StoryRefinementOutput,
): Promise<CheckError[]> {
  const errors: CheckError[] = [];
  const { story } = out;

  if (story.fullText.trim().length === 0) {
    errors.push({
      path: 'story.fullText',
      code: 'empty',
      message: 'The refined story text is blank',
    });
  }

  if (
    story.estimatedSceneCount !== undefined &&
    story.estimatedSceneCount < 1
  ) {
    errors.push({
      path: 'story.estimatedSceneCount',
      code: 'too_small',
      message: 'A story has at least one scene',
    });
  }

  story.keyEvents?.forEach((event, index) => {
    if (event.trim().length === 0) {
      errors.push({
        path: `story.keyEvents.${index}`,
        code: 'empty',
        message: 'A key event is not blank',
      });
    }
  });

  return errors;
}

async function commit(
  ctx: Ctx,
  run: GenerationRun,
  target: StoryRefinementTarget,
  outputs: StoryRefinementOutput[],
): Promise<CommitResult<StoryRefinementData>> {
  const refinedStory = outputs[0]?.story;

  if (!refinedStory) throw new Error('story_refinement commit needs one part');

  const generatedAt = new Date().toISOString();

  // Re-read at commit time: the brief may be old, and the episode may be gone
  const { data: current } = await ctx.client
    .from('episodes')
    .select('story_data, metadata, status, deleted_at, generation_origin')
    .eq('id', target.episodeId)
    .single();

  if (!current || current.deleted_at) {
    ctx.log?.(
      '[Story Refinement] Episode was deleted during refinement. Skipping write.',
    );
    await applyCommit(ctx, {
      ops: [
        jobCompletedWrite(target.episodeId, JOB_TYPE, {
          skipped: true,
          reason: 'episode-deleted',
        }),
      ],
    });

    return {
      status: 'skipped',
      reason: 'episode-deleted',
      data: {
        story: {},
        episode: { id: target.episodeId, status: 'draft' },
      },
    };
  }

  const storyData = storyOf(current.story_data);

  const updatedStoryData = {
    ...storyData,
    fullStory: refinedStory.fullText ?? storyData.fullStory,
    title: refinedStory.title ?? storyData.title,
    actBreakdown: refinedStory.actBreakdown ?? storyData.actBreakdown,
    characters: refinedStory.characters ?? storyData.characters,
    themes: refinedStory.themes ?? storyData.themes,
    tone: refinedStory.tone ?? storyData.tone,
    estimatedSceneCount:
      refinedStory.estimatedSceneCount ?? storyData.estimatedSceneCount,
    episodeSummary: refinedStory.episodeSummary ?? storyData.episodeSummary,
    sentimentScore: refinedStory.sentimentScore ?? storyData.sentimentScore,
    keyEvents: refinedStory.keyEvents ?? storyData.keyEvents,
    viralStructure: refinedStory.viralStructure ?? storyData.viralStructure,
    lastRefinedAt: generatedAt,
  };

  const currentMetadata = (current.metadata as Record<string, unknown>) ?? {};
  const refinementHistory = [
    ...((currentMetadata.refinement_history as RefinementHistoryEntry[]) ?? []),
    {
      timestamp: generatedAt,
      feedback: target.feedback,
      type: 'story' as const,
      userId: ctx.userId,
    },
  ];

  const updatedMetadata = {
    ...currentMetadata,
    previous_story_data: storyData,
    refinement_history: refinementHistory,
  };

  // Who wrote this story, per stage (FILM-1903); the column exists since
  // part A, so `originColumnsAvailable` is the caller's say
  const origin = ctx.originColumnsAvailable
    ? {
        generation_origin: {
          ...((current.generation_origin as Record<string, unknown>) ?? {}),
          story_refinement: run.origin,
        } as unknown as Json,
      }
    : {};

  // One transaction under a run: the story (its content_revisions snapshot
  // with it) and the job's completion. requireRows: the episode was deleted
  const applied = await applyCommit(ctx, {
    ops: [
      {
        key: 'episode',
        op: 'update',
        table: 'episodes',
        values: {
          story_data: updatedStoryData as unknown as Json,
          metadata: updatedMetadata as unknown as Json,
          updated_at: generatedAt,
          ...origin,
        },
        match: [eq('id', target.episodeId), is('deleted_at', null)],
        requireRows: true,
        returning: ['id', 'status'],
      },
      jobCompletedWrite(target.episodeId, JOB_TYPE, {
        provider: run.usage?.provider ?? run.origin.kind,
        model: run.usage?.model ?? run.origin.model ?? 'unknown',
        tokensUsed: run.usage?.tokens ?? 0,
        feedback: target.feedback.substring(0, 200),
      }),
    ],
  });

  const updatedEpisode = applied.results.episode![0] as {
    id: string;
    status: string;
  };

  ctx.log?.(
    `[Story Refinement] Story refined successfully for episode ${target.episodeId}`,
  );

  return {
    status: 'committed',
    data: {
      story: updatedStoryData,
      episode: { id: updatedEpisode.id, status: updatedEpisode.status },
    },
  };
}

export const storyRefinementStage: StageDefinition<
  StoryRefinementTarget,
  StoryRefinementOutput,
  StoryRefinementData
> = registerStage({
  key: 'story_refinement',
  targetType: 'episode',
  targetSchema: StoryRefinementTargetSchema,
  outputSchema: StoryRefinementOutputSchema,
  jobTracking: {
    jobType: JOB_TYPE,
    reference: (target) => ({ type: 'episode', id: target.episodeId }),
  },
  parts,
  prepare,
  check,
  commit,
});
