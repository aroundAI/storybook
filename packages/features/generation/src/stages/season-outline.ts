/**
 * The `season_outline` stage (FILM-1901): one part, the outlines of a run of
 * episodes (a whole season, or one episode regenerated among its
 * neighbours, KB-121).
 *
 * prepare reads the project, its characters, locations and (for a
 * fact-driven type, KB-71) its verified facts, renders `season-outline` as
 * the Season Outliner does, and carries the Season Orchestrator's input in
 * the brief's context. commit creates the episode rows, which
 * `batchCreateEpisodesAction` used to do from the client; the handler still
 * returns the outlines, now carrying each row's id, so the preview's edits
 * update the rows the commit made.
 */
import { z } from 'zod';

import seasonOutline from '@kit/prompt-engine/prompts/story-generation/season-outline.json';
import {
  sanitizeForPrompt,
  sanitizeStrings,
} from '@kit/shared/prompt-sanitiser';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import {
  type CommitWrite,
  applyCommit,
  eq,
  resultRows,
} from '../commit-plan';
import {
  episodeRowFromOutline,
  episodeRowUpdateFromOutline,
} from '../episode-rows';
import {
  formatFactsForSeasonPrompt,
  formatNeighbouringEpisodes,
  formatRecurringElementsForPrompt,
  recurringElementsOf,
} from '../formatters';
import { requiresVerifiedFacts, resolveProjectType } from '../project-type';
import { registerStage } from '../registry';
import type { Brief, CheckError, Ctx, StageDefinition } from '../types';
import {
  EPISODE_TITLE_MAX,
  checkError,
  projectMetadataOf,
  uuid,
} from './shared';

/** Facts offered to one outline; the prompt asks for every one to be placed. */
export const MAX_OUTLINE_FACTS = 100;

const NeighbouringEpisodeSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  premise: z.string(),
  mainPlot: z.string(),
  characterFocus: z.array(z.string()).optional(),
  arcPosition: z.string(),
});

export const SeasonOutlineTargetSchema = z.object({
  projectId: uuid,
  seasonId: uuid.optional(),
  seasonPremise: z.string().min(1),
  episodeCount: z.number().int().positive().max(24),
  startingNumber: z.number().int().positive().default(1),
  genre: z.string().optional(),
  style: z.string().optional(),
  surroundingEpisodes: z.array(NeighbouringEpisodeSchema).max(24).optional(),
  additionalContext: z.string().max(500).optional(),
});

export type SeasonOutlineTarget = z.infer<typeof SeasonOutlineTargetSchema>;

export const ArcPositionSchema = z.enum([
  'setup',
  'rising',
  'midpoint',
  'climax',
  'resolution',
]);

/** One outline, as the `season-outline` prompt declares it. */
export const OutlineSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(EPISODE_TITLE_MAX),
  premise: z.string().min(10).max(500),
  mainPlot: z.string().min(20).max(1000),
  characterFocus: z.array(z.string()).optional(),
  arcPosition: ArcPositionSchema,
  fact_ids: z.array(z.string()).optional(),
});

export type Outline = z.infer<typeof OutlineSchema>;

export const SeasonOutlineStageOutputSchema = z.object({
  episodes: z.array(OutlineSchema).min(1),
  /** The server orchestrator's arc evaluation; absent in external mode */
  evaluation: z
    .object({
      arcScore: z.number().optional(),
      arcSummary: z.string().optional(),
      orchestratorSteps: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type SeasonOutlineStageOutput = z.infer<
  typeof SeasonOutlineStageOutputSchema
>;

/** The Season Orchestrator's input, as the brief's context carries it. */
export const SeasonOutlineBriefContextSchema = z.object({
  seasonPremise: z.string(),
  episodeCount: z.number().int().positive(),
  startingNumber: z.number().int(),
  genre: z.string(),
  style: z.string(),
  existingCharacters: z.string(),
  existingLocations: z.string(),
  recurringElements: z.string(),
  verifiedFacts: z.string().optional(),
  neighbouringEpisodes: z.string().optional(),
});

export type SeasonOutlineBriefContext = z.infer<
  typeof SeasonOutlineBriefContextSchema
>;

export function seasonOutlineOrchestratorInput(
  brief: Brief,
): SeasonOutlineBriefContext {
  return SeasonOutlineBriefContextSchema.parse(brief.context.orchestrator);
}

/** An outline with the row it became. */
export type CreatedOutline = Outline & { id: string };

export interface SeasonOutlineCommitData {
  episodes: CreatedOutline[];
  generatedAt: string;
}

async function loadProjectContext(ctx: Ctx, target: SeasonOutlineTarget) {
  const client = ctx.client;

  const { data: project } = await client
    .from('projects')
    .select('id, name, metadata')
    .eq('id', target.projectId)
    .single();

  // Read for the model only: defused once, here, with the characters and
  // locations below (KB-101)
  const projectMetadata = sanitizeStrings(projectMetadataOf(project));
  const recurringElements = formatRecurringElementsForPrompt(
    recurringElementsOf(projectMetadata),
  );

  const [charactersResult, locationsResult] = await Promise.all([
    client
      .from('assets')
      .select('name, description, metadata')
      .eq('project_id', target.projectId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .limit(10),
    client
      .from('assets')
      .select('name, description')
      .eq('project_id', target.projectId)
      .eq('type', 'location')
      .is('deleted_at', null)
      .limit(10),
  ]);

  const characters = sanitizeStrings(
    (charactersResult.data ?? []) as Array<{
      name: string;
      description: string | null;
    }>,
  );
  const locations = sanitizeStrings(
    (locationsResult.data ?? []) as Array<{
      name: string;
      description: string | null;
    }>,
  );

  const existingCharacters =
    characters.length > 0
      ? characters.map((c) => `- ${c.name}: ${c.description || ''}`).join('\n')
      : 'No characters defined yet.';

  const existingLocations =
    locations.length > 0
      ? locations.map((l) => `- ${l.name}: ${l.description || ''}`).join('\n')
      : 'No locations defined yet.';

  // KB-71: the type is `metadata.projectType`, read the one way every other
  // reader does. Only `verified` facts go in (owner decision, 2026-09-24).
  const { projectType } = resolveProjectType(project?.metadata);
  let verifiedFacts = '';
  let factCount = 0;

  if (requiresVerifiedFacts(projectType)) {
    const [{ data: factsData, error: factsError }, { count: verifiedCount }] =
      await Promise.all([
        client
          .from('verified_facts')
          .select('id, claim, source_citation, category')
          .eq('project_id', target.projectId)
          .eq('verification_status', 'verified')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(MAX_OUTLINE_FACTS),
        client
          .from('verified_facts')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', target.projectId)
          .eq('verification_status', 'verified'),
      ]);

    if (factsError) {
      console.error(
        '[season_outline] Failed to fetch verified facts:',
        factsError,
      );
    }

    const facts = (factsData ?? []) as Array<{
      id: string;
      claim: string;
      source_citation: string | null;
      category: string | null;
    }>;
    factCount = facts.length;

    if (facts.length > 0) {
      verifiedFacts = formatFactsForSeasonPrompt(
        facts.map((f) => ({
          id: f.id,
          claim: sanitizeForPrompt(f.claim),
          source_citation: f.source_citation
            ? sanitizeForPrompt(f.source_citation)
            : null,
          category: f.category ? sanitizeForPrompt(f.category) : null,
        })),
      );
    }

    ctx.log?.(
      `[season_outline] projectType=${projectType} loaded=${facts.length} verified=${verifiedCount ?? 'unknown'}` +
        ((verifiedCount ?? 0) > facts.length
          ? ` (truncated to ${MAX_OUTLINE_FACTS})`
          : ''),
    );
  }

  return {
    projectMetadata,
    projectType,
    recurringElements,
    existingCharacters,
    existingLocations,
    verifiedFacts,
    factCount,
    characterNames: characters.map((c) => c.name),
  };
}

export const seasonOutlineStage: StageDefinition<
  SeasonOutlineTarget,
  SeasonOutlineStageOutput,
  SeasonOutlineCommitData
> = {
  key: 'season_outline',
  targetType: 'season',
  targetSchema: SeasonOutlineTargetSchema,
  outputSchema: SeasonOutlineStageOutputSchema,

  async parts() {
    return [singlePart('outline', 'The episode outlines')];
  },

  async prepare(ctx, target, part) {
    const project = await loadProjectContext(ctx, target);

    const orchestrator: SeasonOutlineBriefContext = {
      seasonPremise: sanitizeForPrompt(target.seasonPremise),
      episodeCount: target.episodeCount,
      startingNumber: target.startingNumber,
      genre: target.genre
        ? sanitizeForPrompt(target.genre)
        : (project.projectMetadata.genre as string) || 'general',
      style: target.style ? sanitizeForPrompt(target.style) : 'cinematic',
      existingCharacters: project.existingCharacters,
      existingLocations: project.existingLocations,
      recurringElements: project.recurringElements,
      verifiedFacts: project.verifiedFacts || undefined,
      neighbouringEpisodes:
        formatNeighbouringEpisodes(
          target.surroundingEpisodes,
          target.additionalContext,
        ) || undefined,
    };

    // The variables the Season Outliner renders (KB-126's names)
    const variables = {
      season_premise: orchestrator.seasonPremise,
      episode_count: target.episodeCount,
      starting_number: target.startingNumber,
      genre: orchestrator.genre,
      style: orchestrator.style,
      characters: project.existingCharacters,
      locations: project.existingLocations,
      recurring_element: project.recurringElements,
      surrounding_episodes: orchestrator.neighbouringEpisodes ?? '',
      verified_facts: project.verifiedFacts,
    };

    return buildBrief({
      stage: 'season_outline',
      part,
      prompt: seasonOutline as PromptFile,
      variables,
      context: {
        orchestrator,
        project: {
          id: target.projectId,
          type: project.projectType,
          characterNames: project.characterNames,
        },
        season: { id: target.seasonId ?? null },
      },
      outputSchema: SeasonOutlineStageOutputSchema,
      constraints: {
        episodeCount: target.episodeCount,
        startingNumber: target.startingNumber,
        titleMax: EPISODE_TITLE_MAX,
        premiseLength: { min: 10, max: 500 },
        mainPlotLength: { min: 20, max: 1000 },
        verifiedFacts:
          project.factCount > 0
            ? `every one of the ${project.factCount} facts appears in some episode's fact_ids`
            : 'none',
      },
      targetVersion: null,
    });
  },

  async check(_ctx, target, out) {
    const errors: CheckError[] = [];

    if (out.episodes.length !== target.episodeCount) {
      errors.push(
        checkError(
          'episodes',
          'count_mismatch',
          `${out.episodes.length} outlines; ${target.episodeCount} were asked for`,
        ),
      );
    }

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
    const out = outputs[0]!;
    const client = ctx.client;
    const generatedAt = new Date().toISOString();
    const seasonId = target.seasonId ?? null;

    // The project's numbers in use, and which of them are generated drafts
    // this commit may replace (a regenerated outline, KB-121)
    const { data: existingRows, error: readError } = await client
      .from('episodes')
      .select('id, number, status, story_data, season_id')
      .eq('project_id', target.projectId)
      .is('deleted_at', null)
      .order('number', { ascending: true });

    if (readError) {
      throw new Error(
        `Failed to read the project's episodes: ${readError.message}`,
      );
    }

    const existing = (existingRows ?? []) as Array<{
      id: string;
      number: number;
      status: string;
      story_data: unknown;
    }>;
    const byNumber = new Map(existing.map((row) => [row.number, row]));
    let nextFree = Math.max(0, ...existing.map((row) => row.number)) + 1;

    const created: CreatedOutline[] = [];
    const toUpdate: Array<{ id: string; number: number; outline: Outline }> =
      [];
    const toInsert: Array<{
      row: ReturnType<typeof episodeRowFromOutline>;
      outline: Outline;
    }> = [];

    out.episodes.forEach((outline, index) => {
      const preferred = target.startingNumber + index;
      const occupant = byNumber.get(preferred);

      if (occupant && isGeneratedDraft(occupant)) {
        toUpdate.push({ id: occupant.id, number: preferred, outline });
        return;
      }

      const number = occupant ? nextFree++ : preferred;
      byNumber.set(number, {
        id: '',
        number,
        status: 'draft',
        story_data: null,
      });
      toInsert.push({
        row: episodeRowFromOutline(outline, {
          projectId: target.projectId,
          seasonId,
          number,
        }),
        outline,
      });
    });

    // One transaction: the drafts this outline replaces and the new rows.
    // requireRows: RLS filters a refused update to no rows (KB-105)
    const applied = await applyCommit(ctx, {
      ops: [
        ...toUpdate.map(
          (update): CommitWrite => ({
            op: 'update',
            table: 'episodes',
            values: {
              ...episodeRowUpdateFromOutline(update.outline),
              generation_origin: run.origin as unknown as Json,
            },
            match: [eq('id', update.id), eq('project_id', target.projectId)],
            requireRows: true,
          }),
        ),
        ...(toInsert.length > 0
          ? [
              {
                key: 'episodes',
                op: 'insert',
                table: 'episodes',
                // Every row carries who wrote it: the run's origin (FILM-1903)
                rows: toInsert.map(({ row }) => ({
                  ...row,
                  generation_origin: run.origin as unknown as Json,
                })),
                returning: ['id', 'number', 'title', 'status'],
              } satisfies CommitWrite,
            ]
          : []),
      ],
    });

    for (const update of toUpdate) {
      created.push({ ...update.outline, number: update.number, id: update.id });
    }

    const inserted = resultRows(applied, 'episodes') as Array<{
      id: string;
      number: number;
    }>;

    toInsert.forEach(({ row, outline }, index) => {
      const id =
        inserted.find((r) => r.number === row.number)?.id ??
        inserted[index]?.id ??
        '';
      created.push({ ...outline, number: row.number, id });
    });

    created.sort((a, b) => a.number - b.number);

    return { status: 'committed', data: { episodes: created, generatedAt } };
  },
};

/** A row an earlier outline commit made, which a regenerated outline replaces. */
function isGeneratedDraft(row: { status: string; story_data: unknown }) {
  const storyData = row.story_data as Record<string, unknown> | null;
  return row.status === 'draft' && storyData?.generatedFromBatch === true;
}

registerStage(seasonOutlineStage);
