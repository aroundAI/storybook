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

      expect(fake.callsOn('assets', 'eq')).toEqual([
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
