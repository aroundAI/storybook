import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkWithSchema } from '../../src/checks';
import { getStage } from '../../src/registry';
import {
  type IdeationTarget,
  ideationOrchestratorInput,
  ideationStage,
} from '../../src/stages/ideation';
import {
  IDS,
  SNAPSHOT,
  TABLES,
  UNRESOLVED_PLACEHOLDER,
  makeCtx,
  responder,
  serverRun,
} from './helpers';

const TARGET: IdeationTarget = {
  episodeId: IDS.episodeId,
  premise: 'A signal from nowhere.',
  numberOfIdeas: 2,
};

const IDEAS = [
  {
    title: 'The Last Signal',
    logline: 'An astronaut hears her own voice from the future.',
    hook: 'The voice is hers.',
    conflict: 'Obey or act.',
    themes: ['isolation'],
    visualPotential: 'One lit console.',
    qualityScore: 0.8,
  },
  {
    title: 'Static',
    logline: 'The signal leaks.',
    hook: 'Someone knew.',
    themes: ['trust'],
    visualPotential: 'Crowds and screens.',
  },
];

describe('ideation stage (FILM-1901)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under its key, with no job tracking (ideation has no generation_jobs row)', () => {
    expect(getStage('ideation')).toBe(ideationStage);
    expect(ideationStage.jobTracking).toBeUndefined();
  });

  it('renders story-ideation with every variable filled and carries the orchestrator input', async () => {
    const { ctx, loads } = makeCtx();
    const [part] = await ideationStage.parts(ctx, TARGET);

    const brief = await ideationStage.prepare(ctx, TARGET, part!);

    expect(loads).toEqual([
      { episodeId: IDS.episodeId, semanticQuery: undefined },
    ]);
    expect(brief.prompt.slug).toBe('story-ideation');
    expect(brief.instructions).not.toMatch(UNRESOLVED_PLACEHOLDER);
    expect(brief.instructions).toContain('Generate 2 unique story ideas');
    expect(brief.prompt.variables).toMatchObject({
      premise: 'A signal from nowhere.',
      number_of_ideas: 2,
      premise_depth_instructions: '',
      weak_indices: '',
    });
    expect(ideationOrchestratorInput(brief)).toEqual({
      premise: 'A signal from nowhere.',
      numberOfIdeas: 2,
      genre: 'sci-fi',
      targetAudience: 'adults',
      contentType: 'series',
      verifiedFactsContext: undefined,
      charactersContext: SNAPSHOT.characters,
      locationsContext: SNAPSHOT.locations,
      seasonContext: expect.stringContaining('This is Episode 2 of Season 1'),
      previousEpisodesContext:
        'Previous episodes in this season: Ep1: "Launch Day"',
      visualStyle: 'cinematic',
      recurringElementsContext: SNAPSHOT.recurringElements,
    });
    expect(brief.qualityRubric).toContain('<the ideas you produce>');
  });

  it("falls back to the episode's own premise, and asks for a deeper logline for a rich premise", async () => {
    const { ctx } = makeCtx();
    const [part] = await ideationStage.parts(ctx, TARGET);

    const own = await ideationStage.prepare(
      ctx,
      { ...TARGET, premise: undefined },
      part!,
    );
    expect(ideationOrchestratorInput(own).premise).toBe(SNAPSHOT.premise);

    const rich = await ideationStage.prepare(
      ctx,
      { ...TARGET, premise: 'x'.repeat(800) },
      part!,
    );
    expect(rich.prompt.variables.premise_depth_instructions).toContain(
      '4-6 sentences',
    );
  });

  it('rejects an idea without a title or a logline with {path, code}', () => {
    const result = checkWithSchema(ideationStage.outputSchema, {
      ideas: [
        { ...IDEAS[0], title: '' },
        { ...IDEAS[1], logline: undefined },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({ path: 'ideas.0.title', code: 'too_small' }),
      expect.objectContaining({
        path: 'ideas.1.logline',
        code: 'invalid_type',
      }),
    ]);
  });

  it('rejects a set of the wrong size', async () => {
    const { ctx } = makeCtx();
    const [part] = await ideationStage.parts(ctx, TARGET);

    const errors = await ideationStage.check(
      ctx,
      TARGET,
      ideationStage.outputSchema.parse({ ideas: [IDEAS[0]] }),
      part!,
    );

    expect(errors).toEqual([
      {
        path: 'ideas',
        code: 'count_mismatch',
        message: '1 ideas; 2 were asked for',
      },
    ]);
  });

  it('stores the ideas on episodes.metadata.ideas, keeping the rest of the metadata', async () => {
    const { ctx, db } = makeCtx();

    const result = await ideationStage.commit(ctx, serverRun(), TARGET, [
      ideationStage.outputSchema.parse({ ideas: IDEAS }),
    ]);

    expect(result.status).toBe('committed');
    expect(result.data.ideas).toEqual(IDEAS);
    expect(db.writes()).toEqual([
      expect.objectContaining({
        table: 'episodes',
        op: 'update',
        payload: {
          metadata: {
            character_ids: ['c1'],
            ideas: IDEAS,
            ideas_generated_at: result.data.generatedAt,
          },
          // Who wrote it, under its own stage key (FILM-1903, FILM-1908)
          generation_origin: {
            ideation: expect.objectContaining({ kind: 'server' }),
          },
        },
      }),
    ]);
  });

  it('skips the write, and still returns the ideas, when the episode is gone', async () => {
    const { ctx, db } = makeCtx(
      responder({
        ...TABLES,
        episodes: { ...(TABLES.episodes as object), deleted_at: '2026-10-03' },
      }),
    );

    const result = await ideationStage.commit(ctx, serverRun(), TARGET, [
      ideationStage.outputSchema.parse({ ideas: IDEAS }),
    ]);

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'episode-deleted',
    });
    expect(result.data.ideas).toEqual(IDEAS);
    expect(db.writes()).toEqual([]);
  });
});
