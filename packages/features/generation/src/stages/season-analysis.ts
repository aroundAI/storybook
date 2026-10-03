/**
 * The `season_analysis` stage (FILM-1901): one part, a roadmap read into a
 * series bible (premise, characters, locations, episodes with their beats).
 *
 * prepare renders `season-generation` with the roadmap, the project's
 * recurring elements (KB-126) and the facts the request carried. No season
 * row exists yet when a roadmap is analysed (`generateSeasonEpisodesAction`
 * creates it from the approved analysis), so commit stores the analysis on
 * `projects.metadata.latestSeasonAnalysis`; the handler keeps returning it.
 */
import { z } from 'zod';

import seasonGeneration from '@kit/prompt-engine/prompts/story-generation/season-generation.json';
import {
  sanitizeForPrompt,
  sanitizeStrings,
} from '@kit/shared/prompt-sanitiser';
import { whyNoRow } from '@kit/shared/rows';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { applyCommit, eq } from '../commit-plan';
import {
  formatFactsForSeasonPrompt,
  formatRecurringElementsForPrompt,
  recurringElementsOf,
} from '../formatters';
import { registerStage } from '../registry';
import type { CheckError, StageDefinition } from '../types';
import {
  EPISODE_TITLE_MAX,
  checkError,
  projectMetadataOf,
  uuid,
} from './shared';

const ExternalFactSchema = z.object({
  id: z.string().optional(),
  claim: z.string(),
  source_citation: z.string().nullish(),
  category: z.string().nullish(),
});

export const SeasonAnalysisTargetSchema = z.object({
  projectId: uuid,
  roadmap: z.string().min(1),
  externalFacts: z.array(ExternalFactSchema).optional(),
});

export type SeasonAnalysisTarget = z.infer<typeof SeasonAnalysisTargetSchema>;

const BeatSchema = z.object({ label: z.string(), content: z.string() });

export const AnalysedCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.string(),
  description: z.string(),
  physicalDescription: z.string().optional(),
  clothingStyle: z.string().optional(),
  mannerisms: z.string().optional(),
});

export const AnalysedLocationSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  setting: z.string().nullish(),
  visualDescription: z.string().optional(),
  timeOfDay: z.string().nullish(),
  weather: z.string().nullish(),
});

export const AnalysedEpisodeSchema = z.object({
  number: z.number().int(),
  title: z.string().min(1).max(EPISODE_TITLE_MAX),
  synopsis: z.string(),
  beats: z.array(BeatSchema),
  moral: z.string().nullish(),
  signature_line: z.string().nullish(),
  character_names: z.array(z.string()).default([]),
  location_names: z.array(z.string()).default([]),
  tags: z.array(z.string()).optional(),
  fact_ids: z.array(z.string()).optional(),
});

/** The `season-generation` prompt's output, as its output.schema declares it. */
export const SeasonAnalysisOutputSchema = z.object({
  premise: z.string().min(1),
  tone: z.string().nullish(),
  target_audience: z.string().nullish(),
  characters: z.array(AnalysedCharacterSchema).default([]),
  locations: z.array(AnalysedLocationSchema).default([]),
  episodes: z.array(AnalysedEpisodeSchema).min(1),
});

export type SeasonAnalysisOutput = z.infer<typeof SeasonAnalysisOutputSchema>;

export interface SeasonAnalysisCommitData {
  analysis: SeasonAnalysisOutput;
  generatedAt: string;
}

export const seasonAnalysisStage: StageDefinition<
  SeasonAnalysisTarget,
  SeasonAnalysisOutput,
  SeasonAnalysisCommitData
> = {
  key: 'season_analysis',
  targetType: 'project',
  targetSchema: SeasonAnalysisTargetSchema,
  outputSchema: SeasonAnalysisOutputSchema,

  async parts() {
    return [singlePart('analysis', 'The roadmap analysis')];
  },

  async prepare(ctx, target, part) {
    const facts = target.externalFacts ?? [];

    // The user's roadmap and facts, defused for the model (KB-101)
    const verifiedFacts =
      facts.length > 0
        ? formatFactsForSeasonPrompt(sanitizeStrings(facts))
        : '';

    // The project's recurring elements: the template has a place for them,
    // and nothing filled it (KB-126)
    const { data: project } = await ctx.client
      .from('projects')
      .select('metadata')
      .eq('id', target.projectId)
      .single();

    const projectMetadata = sanitizeStrings(projectMetadataOf(project));
    const recurringElement = formatRecurringElementsForPrompt(
      recurringElementsOf(projectMetadata),
    );

    const variables = {
      roadmap: sanitizeForPrompt(target.roadmap),
      verified_facts: verifiedFacts,
      recurring_element: recurringElement,
    };

    return buildBrief({
      stage: 'season_analysis',
      part,
      prompt: seasonGeneration as PromptFile,
      variables,
      context: {
        project: { id: target.projectId },
        factIds: facts.map((f, i) => f.id ?? `fact-${i + 1}`),
      },
      outputSchema: SeasonAnalysisOutputSchema,
      constraints: {
        titleMax: EPISODE_TITLE_MAX,
        preserveLabels: 'beats keep the roadmap’s own headings, in order',
        verifiedFacts:
          facts.length > 0
            ? `every one of the ${facts.length} facts appears in some episode's fact_ids`
            : 'none',
      },
      targetVersion: null,
    });
  },

  async check(_ctx, _target, out) {
    const errors: CheckError[] = [];
    const seen = new Set<number>();

    out.episodes.forEach((episode, index) => {
      if (seen.has(episode.number)) {
        errors.push(
          checkError(
            `episodes.${index}.number`,
            'duplicate_number',
            `episode number ${episode.number} appears twice`,
          ),
        );
      }
      seen.add(episode.number);
    });

    return errors;
  },

  async commit(ctx, run, target, outputs) {
    const analysis = outputs[0]!;
    const generatedAt = new Date().toISOString();

    const { data: project, error: readError } = await ctx.client
      .from('projects')
      .select('metadata')
      .eq('id', target.projectId)
      .single();

    if (readError || !project) {
      throw new Error(whyNoRow(readError, 'Project not found'));
    }

    const metadata = projectMetadataOf(project);

    // requireRows: RLS filters a refused update to no rows, without an
    // error (KB-105)
    await applyCommit(ctx, {
      ops: [
        {
          op: 'update',
          table: 'projects',
          values: {
            metadata: {
              ...metadata,
              latestSeasonAnalysis: {
                generatedAt,
                mode: run.mode,
                analysis,
              },
            } as Json,
          },
          match: [eq('id', target.projectId)],
          requireRows: true,
        },
      ],
    });

    return { status: 'committed', data: { analysis, generatedAt } };
  },
};

registerStage(seasonAnalysisStage);
