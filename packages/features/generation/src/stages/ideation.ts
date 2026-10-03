/**
 * The `ideation` stage (FILM-1901): one part, the episode's story ideas.
 *
 * prepare renders `story-ideation` with the variables the Ideation Director
 * renders for its first call and carries the Ideation Orchestrator's input
 * in the brief's context. commit stores the ideas on
 * `episodes.metadata.ideas` for both modes (lead decision, 2026-10-03: the
 * README's open question 3); the handler still returns them to the client.
 */
import { z } from 'zod';

import { ProjectTypeSchema } from '@kit/film-studio-schemas/project';
import storyIdeation from '@kit/prompt-engine/prompts/story-generation/story-ideation.json';
import { StoryIdeaSchema } from '@kit/prompt-engine/schemas';
import { sanitizeForPrompt } from '@kit/shared/prompt-sanitiser';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { premiseDepthInstructions } from '../formatters';
import { registerStage } from '../registry';
import type { Brief, CheckError, StageDefinition } from '../types';
import {
  checkError,
  directionNotes,
  loadEpisodeContext,
  projectTypeOf,
  readEpisode,
  seasonLine,
  uuid,
} from './shared';

export const IdeationTargetSchema = z.object({
  episodeId: uuid,
  /** The user's premise; the episode's own when absent */
  premise: z.string().optional(),
  numberOfIdeas: z.number().int().positive().default(3),
});

export type IdeationTarget = z.infer<typeof IdeationTargetSchema>;

export const IdeaSchema = StoryIdeaSchema.extend({
  title: z.string().min(1),
  logline: z.string().min(1),
  conflict: z.string().optional(),
  qualityScore: z.number().optional(),
  viralPotential: z
    .object({
      score: z.number().min(1).max(10),
      curiosityGap: z.string(),
      emotionalAnchor: z.string(),
      shareability: z.string(),
    })
    .optional(),
});

export const IdeationStageOutputSchema = z.object({
  ideas: z.array(IdeaSchema).min(1),
});

export type IdeationStageOutput = z.infer<typeof IdeationStageOutputSchema>;

/** The Ideation Orchestrator's input, as the brief's context carries it. */
export const IdeationBriefContextSchema = z.object({
  premise: z.string(),
  numberOfIdeas: z.number().int().positive(),
  genre: z.string(),
  targetAudience: z.string(),
  contentType: ProjectTypeSchema.optional(),
  verifiedFactsContext: z.string().optional(),
  charactersContext: z.string(),
  locationsContext: z.string(),
  seasonContext: z.string().optional(),
  previousEpisodesContext: z.string().optional(),
  visualStyle: z.string().optional(),
  recurringElementsContext: z.string(),
});

export type IdeationBriefContext = z.infer<typeof IdeationBriefContextSchema>;

export function ideationOrchestratorInput(brief: Brief): IdeationBriefContext {
  return IdeationBriefContextSchema.parse(brief.context.orchestrator);
}

export interface IdeationCommitData {
  ideas: IdeationStageOutput['ideas'];
  generatedAt: string;
}

export const ideationStage: StageDefinition<
  IdeationTarget,
  IdeationStageOutput,
  IdeationCommitData
> = {
  key: 'ideation',
  targetType: 'episode',
  targetSchema: IdeationTargetSchema,
  outputSchema: IdeationStageOutputSchema,

  async parts() {
    return [singlePart('ideas', 'The story ideas')];
  },

  async prepare(ctx, target, part) {
    const snapshot = await loadEpisodeContext(ctx, target.episodeId);
    const episode = await readEpisode(ctx.client, target.episodeId);

    const season = seasonLine(snapshot) || undefined;
    const notes = directionNotes(snapshot);
    const seasonContext = season || notes ? (season ?? '') + notes : undefined;

    const previousEpisodesContext = snapshot.previousEpisodeTitles?.length
      ? `Previous episodes in this season: ${snapshot.previousEpisodeTitles.map((ep) => `Ep${ep.number}: "${ep.title}"`).join(', ')}`
      : undefined;

    // Payload text is the user's: defused before the model sees it (KB-101)
    const premise = target.premise
      ? sanitizeForPrompt(target.premise)
      : (snapshot.premise ?? '');
    const genre = snapshot.genre ?? 'general';
    const targetAudience = snapshot.targetAudience ?? 'general';

    const orchestrator: IdeationBriefContext = {
      premise,
      numberOfIdeas: target.numberOfIdeas,
      genre,
      targetAudience,
      contentType: projectTypeOf(snapshot),
      verifiedFactsContext: snapshot.verifiedFacts || undefined,
      charactersContext: snapshot.characters,
      locationsContext: snapshot.locations,
      seasonContext,
      previousEpisodesContext,
      visualStyle: snapshot.visualStyle,
      recurringElementsContext: snapshot.recurringElements ?? '',
    };

    // The variables the Ideation Director renders for its first call
    const variables = {
      premise,
      number_of_ideas: target.numberOfIdeas,
      genre,
      target_audience: targetAudience,
      characters: snapshot.characters,
      locations: snapshot.locations,
      season_context: seasonContext ?? '',
      previous_episodes: previousEpisodesContext ?? '',
      visual_style: snapshot.visualStyle ?? '',
      recurring_element: snapshot.recurringElements ?? '',
      premise_depth_instructions: premiseDepthInstructions(premise),
      weak_indices: '',
    };

    return buildBrief({
      stage: 'ideation',
      part,
      prompt: storyIdeation as PromptFile,
      variables,
      context: {
        orchestrator,
        episode: { id: target.episodeId, number: snapshot.episodeNumber },
      },
      outputSchema: IdeationStageOutputSchema,
      constraints: {
        ideaCount: target.numberOfIdeas,
        distinct: 'each idea differs in tone, conflict and visual approach',
      },
      targetVersion: episode?.version ?? null,
      rubricVariables: { genre, target_audience: targetAudience },
    });
  },

  async check(_ctx, target, out) {
    const errors: CheckError[] = [];

    if (out.ideas.length !== target.numberOfIdeas) {
      errors.push(
        checkError(
          'ideas',
          'count_mismatch',
          `${out.ideas.length} ideas; ${target.numberOfIdeas} were asked for`,
        ),
      );
    }

    return errors;
  },

  async commit(ctx, run, target, outputs) {
    const out = outputs[0]!;
    const generatedAt = new Date().toISOString();
    const episode = await readEpisode(ctx.client, target.episodeId);

    if (!episode || episode.deleted_at) {
      ctx.log?.(
        '[ideation] Episode was deleted during ideation. Skipping write.',
      );

      return {
        status: 'skipped',
        reason: 'episode-deleted',
        data: { ideas: out.ideas, generatedAt },
      };
    }

    const metadata = (episode.metadata as Record<string, unknown>) ?? {};

    const { data: updated, error } = await ctx.client
      .from('episodes')
      .update({
        metadata: {
          ...metadata,
          ideas: out.ideas,
          ideas_generated_at: generatedAt,
        } as Json,
        // Who wrote it: the run's origin (FILM-1903)
        generation_origin: run.origin as unknown as Json,
      })
      .eq('id', target.episodeId)
      .is('deleted_at', null)
      .select('id');

    if (error) {
      throw new Error(`Failed to store the ideas: ${error.message}`);
    }

    // RLS filters a refused update to no rows, without an error (KB-105)
    if (!updated?.length) {
      throw new Error('Failed to store the ideas: the episode was not updated');
    }

    return { status: 'committed', data: { ideas: out.ideas, generatedAt } };
  },
};

registerStage(ideationStage);
