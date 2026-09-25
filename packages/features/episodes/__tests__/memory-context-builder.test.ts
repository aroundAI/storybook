import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectType } from '@kit/film-studio-schemas/project';

import { buildMemoryContext } from '../src/lib/canon/memory-context-builder';
import { createFakeCanonClient } from './helpers/fake-canon-client';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Hand-computed from CONTENT_TYPE_CONFIGS (contextWindowPercent, memoryHorizon)
 * and MEMORY_ALLOCATIONS, over the 40,000-token window — deliberately not read
 * back from either table, so a change to one of them fails here.
 * Columns: total, events, characters, world, threads, summaries,
 *          sourcesCitations, parentContext, horizon.
 */
const EXPECTED: Record<ProjectType, number[]> = {
  'short-film': [6000, 1800, 1800, 600, 900, 900, 0, 0, 10],
  series: [7200, 2520, 1800, 720, 1440, 720, 0, 0, 50],
  movie: [8000, 2400, 2400, 1200, 1200, 800, 0, 0, 3],
  documentary: [4000, 400, 200, 200, 400, 800, 2000, 0, 5],
  educational: [4800, 720, 720, 480, 720, 720, 1440, 0, 5],
  ad: [4000, 800, 1600, 600, 400, 600, 0, 0, 1],
  news: [2000, 0, 0, 0, 0, 0, 2000, 0, 1],
};

function projectRow(metadata: unknown) {
  return { projects: { rows: [{ metadata }] } };
}

describe('buildMemoryContext (FILM-1110)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('budgets follow the stored project type', () => {
    it.each(Object.entries(EXPECTED))(
      '%s',
      async (projectType, [total, ev, ch, wo, th, su, so, pa, horizon]) => {
        const fake = createFakeCanonClient(projectRow({ projectType }));

        const context = await buildMemoryContext(fake.client, {
          projectId: PROJECT_ID,
          episodeNumber: 6,
        });

        expect(context.metadata.projectType).toBe(projectType);
        expect(context.metadata.projectTypeSource).toBe('metadata');
        expect(context.tokenBudget.total).toBe(total);
        expect(context.metadata.budgets).toEqual({
          immutableEvents: ev,
          characterStates: ch,
          worldStates: wo,
          narrativeThreads: th,
          episodeSummaries: su,
          sourcesCitations: so,
          parentContext: pa,
        });
        expect(context.metadata.memoryHorizon).toBe(horizon);
        expect(context.metadata.memoryHorizonSource).toBe('content-type');
      },
    );

    it('reads the type of the project it was asked about', async () => {
      const fake = createFakeCanonClient(projectRow({ projectType: 'ad' }));

      await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
      });

      expect(fake.callsOn('projects', 'eq')).toEqual([
        ['eq', 'id', PROJECT_ID],
      ]);
    });
  });

  describe('falls back to series when the type cannot be read', () => {
    it.each([
      ['no project row', {}],
      ['metadata without a type', projectRow({ genre: 'drama' })],
      ['a type outside the enum', projectRow({ projectType: 'podcast' })],
      [
        'a failed project read',
        { projects: { error: { message: 'permission denied' } } },
      ],
    ])('%s', async (_label, tables) => {
      const fake = createFakeCanonClient(tables);

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
      });

      expect(context.metadata.projectType).toBe('series');
      expect(context.metadata.projectTypeSource).toBe('default');
      expect(context.tokenBudget.total).toBe(7200);
    });
  });

  describe('explicit arguments still win', () => {
    it('uses a projectType argument over the stored one', async () => {
      const fake = createFakeCanonClient(projectRow({ projectType: 'series' }));

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
        projectType: 'news',
      });

      expect(context.metadata.projectType).toBe('news');
      expect(context.metadata.projectTypeSource).toBe('argument');
      expect(context.tokenBudget.total).toBe(2000);
    });

    it('uses a tokenBudgetPercent argument over the type', async () => {
      const fake = createFakeCanonClient(projectRow({ projectType: 'series' }));

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
        tokenBudgetPercent: 25,
      });

      expect(context.tokenBudget.total).toBe(10000);
      expect(context.metadata.budgets.immutableEvents).toBe(3500);
    });

    it('uses and clamps a memoryHorizon argument', async () => {
      const fake = createFakeCanonClient(projectRow({ projectType: 'series' }));

      const low = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
        memoryHorizon: 0,
      });
      const high = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
        memoryHorizon: 10_000,
      });

      expect(low.metadata.memoryHorizon).toBe(1);
      expect(low.metadata.memoryHorizonSource).toBe('argument');
      expect(high.metadata.memoryHorizon).toBe(100);
    });
  });

  describe('reads the columns the schema has', () => {
    it('selects characters by assets.type', async () => {
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'series' }),
        assets: { rows: [{ id: 'c1', name: 'Jon' }] },
      });

      await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 6,
      });

      // The read is paged (FILM-1111), so look at one request's filters
      const firstPage = fake.queries.find((q) => q.table === 'assets')!;
      expect(firstPage.calls.filter(([m]) => m === 'eq')).toEqual([
        ['eq', 'project_id', PROJECT_ID],
        ['eq', 'type', 'character'],
      ]);
    });

    it('windows summaries on episodes.number by the type horizon', async () => {
      const series = createFakeCanonClient(
        projectRow({ projectType: 'series' }),
      );
      const ad = createFakeCanonClient(projectRow({ projectType: 'ad' }));

      await buildMemoryContext(series.client, {
        projectId: PROJECT_ID,
        episodeNumber: 6,
      });
      await buildMemoryContext(ad.client, {
        projectId: PROJECT_ID,
        episodeNumber: 6,
      });

      // series: horizon 50 reaches back to episode 1; ad: horizon 1 → 5 only
      expect(
        series.callsOn('episodes').filter(([m]) => m !== 'select'),
      ).toEqual([
        ['eq', 'project_id', PROJECT_ID],
        ['gte', 'number', 1],
        ['lt', 'number', 6],
      ]);
      expect(ad.callsOn('episodes', 'gte')).toEqual([['gte', 'number', 5]]);
    });

    it('returns the canon rows the tables hold', async () => {
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'series' }),
        assets: { rows: [{ id: 'c1', name: 'Jon' }] },
        character_states: {
          rows: [
            {
              id: 's1',
              character_id: 'c1',
              episode_id: 'e2',
              state_type: 'knowledge',
              state_value: { knows: 'the vault code' },
              trigger_event: 'overheard',
            },
          ],
        },
        episodes: { rows: [{ id: 'e2' }] },
        episode_summaries: {
          rows: [
            { id: 'sum1', episode_id: 'e2', plot_summary: 'Jon listens.' },
          ],
        },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 6,
      });

      expect(context.characterStates.map((c) => c.characterName)).toEqual([
        'Jon',
      ]);
      expect(context.recentSummaries.map((s) => s.plotSummary)).toEqual([
        'Jon listens.',
      ]);
    });
  });

  it('logs the type, budget and horizon it used', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fake = createFakeCanonClient(projectRow({ projectType: 'ad' }));

    await buildMemoryContext(fake.client, {
      projectId: PROJECT_ID,
      episodeNumber: 2,
    });

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        `[MemoryContext] project=${PROJECT_ID} type=ad(metadata) budget=4000 horizon=1(content-type)`,
      ),
    );
  });
});

describe('saved Canon settings horizon in the builder (FILM-1110)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('uses a horizon the user chose', async () => {
    const fake = createFakeCanonClient(
      projectRow({
        projectType: 'series',
        canon: { memoryHorizon: 4, memoryHorizonMode: 'custom' },
      }),
    );

    const context = await buildMemoryContext(fake.client, {
      projectId: PROJECT_ID,
      episodeNumber: 6,
    });

    expect(context.metadata.memoryHorizon).toBe(4);
    expect(context.metadata.memoryHorizonSource).toBe('canon-settings');
    expect(fake.callsOn('episodes', 'gte')).toEqual([['gte', 'number', 2]]);
  });

  it.each([
    [
      'saved automatic',
      { memoryHorizon: null, memoryHorizonMode: 'automatic' },
    ],
    ['an untouched save from the old form', { memoryHorizon: 10 }],
  ])('uses the content type for %s', async (_label, canon) => {
    const fake = createFakeCanonClient(
      projectRow({ projectType: 'series', canon }),
    );

    const context = await buildMemoryContext(fake.client, {
      projectId: PROJECT_ID,
      episodeNumber: 6,
    });

    expect(context.metadata.memoryHorizon).toBe(50);
    expect(context.metadata.memoryHorizonSource).toBe('content-type');
  });
});

// =============================================================================
// FILM-1111: content-type strategies — ranking, sources, news
// =============================================================================

/** Episode `e<n>` has number n, as `episodes (id, number)` returns it */
function episodes(...numbers: number[]) {
  return { rows: numbers.map((n) => ({ id: `e${n}`, number: n })) };
}

function thread(
  id: string,
  name: string,
  openedIn: number,
  touched: number[],
  updatedAt: string,
) {
  return {
    id,
    project_id: PROJECT_ID,
    thread_name: name,
    thread_type: 'plot',
    status: 'open',
    opened_at: `e${openedIn}`,
    resolved_at: null,
    episodes_touched: touched.map((n) => `e${n}`),
    promises: [],
    payoffs: [],
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: updatedAt,
  };
}

function state(id: string, characterId: string, episode: number) {
  return {
    id,
    character_id: characterId,
    episode_id: `e${episode}`,
    state_type: 'emotional',
    state_value: { mood: 'tense' },
    trigger_event: 'something happened',
    cost: null,
    new_constraints: null,
    previous_state_id: null,
    created_at: '2026-01-01T00:00:00Z',
    created_by: null,
  };
}

function fact(id: string, claim: string, confidence: number) {
  return {
    id,
    claim,
    source_citation: `Source for ${id}`,
    source_title: null,
    category: 'history',
    confidence_score: confidence,
  };
}

function event(id: string, description: string, createdAt: string) {
  return {
    id,
    project_id: PROJECT_ID,
    event_type: 'world_fact',
    event_key: id,
    established_in: 'e1',
    season: 1,
    episode_number: 1,
    description,
    metadata: {},
    created_at: createdAt,
    created_by: null,
  };
}

/** The same canon for any type: §3 of the FILM-1111 EDD, at episode 60 */
function storyCanon(projectType: string) {
  return {
    ...projectRow({ projectType }),
    episodes: episodes(1, 2, 3, 30, 40, 48, 52, 55, 57, 58),
    // Stored order is the reverse of the ranked order, and `updated_at`
    // favours the stale thread, so neither can pass for ranking. T-once was
    // touched more recently than T-hot (57 vs 55) but only once: series
    // scores 0.95^3 = 0.857 against 0.95^5 × 1.2 = 0.929, so only the
    // mention boost puts T-hot first.
    narrative_threads: {
      rows: [
        thread('t-old', 'T-old', 1, [1, 2], '2026-09-20T00:00:00Z'),
        thread('t-mid', 'T-mid', 30, [30], '2026-09-10T00:00:00Z'),
        thread('t-once', 'T-once', 57, [57], '2026-09-15T00:00:00Z'),
        thread('t-hot', 'T-hot', 40, [40, 48, 52, 55], '2026-09-01T00:00:00Z'),
      ],
    },
    assets: {
      rows: [
        { id: 'c-mara', name: 'Mara' },
        { id: 'c-jon', name: 'Jon' },
      ],
    },
    character_states: {
      rows: [state('s-mara', 'c-mara', 3), state('s-jon', 'c-jon', 58)],
    },
  };
}

describe('content-type strategies in the builder (FILM-1111)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('ranks by calculatePriority before fitting the budget', () => {
    it('orders threads by last-touched episode, with the mention boost', async () => {
      const fake = createFakeCanonClient(storyCanon('series'));

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      expect(context.activeThreads.map((t) => t.threadName)).toEqual([
        'T-hot',
        'T-once',
        'T-mid',
        'T-old',
      ]);
    });

    it('orders characters by their latest episode, not table order', async () => {
      const fake = createFakeCanonClient(storyCanon('series'));

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      expect(context.characterStates.map((c) => c.characterName)).toEqual([
        'Jon',
        'Mara',
      ]);
    });

    it('keeps the most recently active character when only one fits', async () => {
      // tokenBudgetPercent 1 → 400 tokens; series gives characters 25% = 100,
      // room for one character context but not two.
      const fake = createFakeCanonClient(storyCanon('series'));

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
        tokenBudgetPercent: 1,
      });

      expect(context.metadata.budgets.characterStates).toBe(100);
      expect(context.characterStates.map((c) => c.characterName)).toEqual([
        'Jon',
      ]);
    });

    it('orders summaries by episode recency inside the horizon', async () => {
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'series' }),
        episodes: episodes(3, 5, 4),
        episode_summaries: {
          rows: [
            { id: 's3', episode_id: 'e3', plot_summary: 'three' },
            { id: 's5', episode_id: 'e5', plot_summary: 'five' },
            { id: 's4', episode_id: 'e4', plot_summary: 'four' },
          ],
        },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 6,
      });

      expect(context.recentSummaries.map((s) => s.plotSummary)).toEqual([
        'five',
        'four',
        'three',
      ]);
    });

    it('resolves the episodes threads and states name, by id', async () => {
      const fake = createFakeCanonClient(storyCanon('series'));

      await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      // One id list, drained page by page
      const lookup = fake.callsOn('episodes', 'in');
      expect(lookup.map(([, column]) => column)).toEqual(['id', 'id']);
      expect(new Set(lookup[0]![2] as string[])).toEqual(
        new Set([
          'e1',
          'e2',
          'e3',
          'e30',
          'e40',
          'e48',
          'e52',
          'e55',
          'e57',
          'e58',
        ]),
      );
    });

    it('keeps every thread and character when episode numbers cannot be read', async () => {
      const fake = createFakeCanonClient({
        ...storyCanon('series'),
        episodes: { error: { message: 'boom' } },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      expect(context.activeThreads).toHaveLength(4);
      expect(context.characterStates).toHaveLength(2);
    });
  });

  describe('immutable events are never decayed (owner decision D1)', () => {
    it('pages every event and keeps them oldest first', async () => {
      // 1,200 events; the oldest — a death — is stored on the third page.
      const rows = Array.from({ length: 1200 }, (_, i) =>
        i === 1100
          ? {
              ...event('ev-1100', 'Mara died', '2025-01-01T00:00:00Z'),
              event_type: 'death',
            }
          : event(
              `ev-${String(i).padStart(4, '0')}`,
              `fact ${i}`,
              '2026-02-01T00:00:00Z',
            ),
      );
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'series' }),
        immutable_events: { rows },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      expect(fake.callsOn('immutable_events', 'range')).toEqual([
        ['range', 0, 499],
        ['range', 500, 999],
        ['range', 1000, 1499],
        ['range', 1200, 1699],
      ]);
      expect(context.immutableEvents[0]?.description).toBe('Mara died');
    });

    it('does not reorder events by recency', async () => {
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'series' }),
        immutable_events: {
          rows: [
            event('ev-new', 'newer', '2026-06-01T00:00:00Z'),
            event('ev-old', 'older', '2026-01-01T00:00:00Z'),
          ],
        },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      expect(context.immutableEvents.map((e) => e.description)).toEqual([
        'older',
        'newer',
      ]);
    });
  });

  describe("sources: the project's verified facts (owner decision D2)", () => {
    it('reads verified facts only, highest confidence first, at most 200', async () => {
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'documentary' }),
        verified_facts: {
          rows: [fact('f1', 'The dam opened in 1936.', 0.9)],
        },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
      });

      expect(fake.callsOn('verified_facts').slice(1)).toEqual([
        ['eq', 'project_id', PROJECT_ID],
        ['eq', 'verification_status', 'verified'],
        ['order', 'confidence_score', { ascending: false, nullsFirst: false }],
        ['order', 'id'],
        ['limit', 200],
      ]);
      expect(context.sources).toEqual([
        {
          factId: 'f1',
          claim: 'The dam opened in 1936.',
          citation: 'Source for f1',
          category: 'history',
          confidence: 0.9,
        },
      ]);
      expect(context.tokenBudget.byCategory.sourcesCitations).toBeGreaterThan(
        0,
      );
    });

    it('fits facts to the source budget', async () => {
      // documentary: 2,000 tokens for sources ≈ 8,000 characters
      const fake = createFakeCanonClient({
        ...projectRow({ projectType: 'documentary' }),
        verified_facts: {
          rows: [
            fact('f1', 'short', 0.9),
            fact('f2', 'x'.repeat(9000), 0.8),
            fact('f3', 'also short', 0.7),
          ],
        },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 2,
      });

      expect(context.sources.map((s) => s.factId)).toEqual(['f1']);
    });

    it.each(['series', 'movie', 'short-film', 'ad'])(
      'issues no facts query for %s, which has no source budget',
      async (projectType) => {
        const fake = createFakeCanonClient(projectRow({ projectType }));

        const context = await buildMemoryContext(fake.client, {
          projectId: PROJECT_ID,
          episodeNumber: 2,
        });

        expect(fake.queries.map((q) => q.table)).not.toContain(
          'verified_facts',
        );
        expect(context.sources).toEqual([]);
      },
    );
  });

  describe('news carries no episode history (owner decision D4)', () => {
    it('returns its facts and nothing narrative, with canon rows present', async () => {
      const fake = createFakeCanonClient({
        ...storyCanon('news'),
        immutable_events: {
          rows: [event('ev1', 'A fact', '2026-01-01T00:00:00Z')],
        },
        episode_summaries: {
          rows: [{ id: 's1', episode_id: 'e58', plot_summary: 'Before.' }],
        },
        world_states: {
          rows: [
            {
              id: 'w1',
              project_id: PROJECT_ID,
              episode_id: 'e58',
              location: 'Newsroom',
            },
          ],
        },
        verified_facts: { rows: [fact('f1', 'Rates rose 0.25%.', 0.95)] },
      });

      const context = await buildMemoryContext(fake.client, {
        projectId: PROJECT_ID,
        episodeNumber: 60,
      });

      expect(context.immutableEvents).toEqual([]);
      expect(context.characterStates).toEqual([]);
      expect(context.activeThreads).toEqual([]);
      expect(context.recentSummaries).toEqual([]);
      expect(context.worldState).toBeUndefined();
      expect(context.sources.map((s) => s.factId)).toEqual(['f1']);
    });
  });

  it('reports and logs the decay it ranked with and the sources it loaded', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fake = createFakeCanonClient({
      ...projectRow({ projectType: 'documentary' }),
      verified_facts: { rows: [fact('f1', 'A claim.', 0.5)] },
    });

    const context = await buildMemoryContext(fake.client, {
      projectId: PROJECT_ID,
      episodeNumber: 2,
    });

    expect(context.metadata.decayFunction).toBe('topic_match');
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('decay=topic_match'),
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('sources=1'));
  });
});

describe('thread last-active episode for CANON_007 (KB-72)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('carries the latest episode each thread was opened or touched in', async () => {
    const fake = createFakeCanonClient({
      ...projectRow({ projectType: 'series' }),
      episodes: episodes(40, 48, 52, 55, 58, 59),
      narrative_threads: {
        rows: [
          thread(
            't-hot',
            'T-hot',
            40,
            [40, 48, 52, 55],
            '2026-09-01T00:00:00Z',
          ),
          thread('t-new', 'T-new', 58, [58, 59], '2026-09-01T00:00:00Z'),
          thread('t-gone', 'T-gone', 7, [7], '2026-09-01T00:00:00Z'),
        ],
      },
    });

    const context = await buildMemoryContext(fake.client, {
      projectId: PROJECT_ID,
      episodeNumber: 60,
    });

    expect(
      Object.fromEntries(
        context.activeThreads.map((t) => [
          t.threadName,
          t.lastActiveEpisodeNumber,
        ]),
      ),
    ).toEqual({ 'T-new': 59, 'T-hot': 55, 'T-gone': undefined });
  });
});
