import { describe, expect, it } from 'vitest';

import { OptimisticLockError } from '../src/lib/status-workflow';
import { setStageSkipped } from '../src/server/episode.service';
import { reorderSeasons, softDeleteSeason } from '../src/server/season.service';

/**
 * FILM-2201: reorder_seasons and soft_delete_season raise SQLSTATEs
 * (flexible-production.test.sql pins them against the database); the service
 * turns each into a refusal the user can read, a stale version into
 * OptimisticLockError, and anything else into a thrown error.
 */
function rpcClient(result: { data: unknown; error: unknown }) {
  return {
    rpc: async () => result,
  } as unknown as Parameters<typeof reorderSeasons>[0];
}

describe('season RPC refusals', () => {
  it.each([
    ['22023', 'Give every season of the project exactly once.', 'invalid'],
    [
      '42501',
      "You can't change this project's seasons (project owner or admin).",
      'forbidden',
    ],
    ['P0002', 'Season not found.', 'not_found'],
  ])('%s becomes a refusal', async (code, refusal, reason) => {
    const client = rpcClient({ data: null, error: { code, message: 'x' } });

    await expect(
      reorderSeasons(client, { projectId: 'p', seasonIds: ['s'] }),
    ).resolves.toEqual({ ok: false, refusal, reason });
    await expect(
      softDeleteSeason(client, { seasonId: 's', version: 1 }),
    ).resolves.toEqual({ ok: false, refusal, reason });
  });

  it('a delete at a stale version is an optimistic-lock conflict', async () => {
    const client = rpcClient({
      data: null,
      error: { code: '40001', message: 'changed' },
    });

    await expect(
      softDeleteSeason(client, { seasonId: 's', version: 1 }),
    ).rejects.toBeInstanceOf(OptimisticLockError);
  });

  it('an unexpected failure throws', async () => {
    const client = rpcClient({
      data: null,
      error: { code: '08006', message: 'connection lost' },
    });

    await expect(
      reorderSeasons(client, { projectId: 'p', seasonIds: ['s'] }),
    ).rejects.toThrow('Failed to reorder seasons: connection lost');
  });

  it('reports how many episodes a delete moved', async () => {
    const client = rpcClient({ data: 2, error: null });

    await expect(
      softDeleteSeason(client, { seasonId: 's', version: 3 }),
    ).resolves.toEqual({ ok: true, data: { episodesMoved: 2 } });
  });
});

describe('setStageSkipped', () => {
  function episodeClient(current: {
    skipped_stages: string[];
    version: number;
  }) {
    const writes: Array<Record<string, unknown>> = [];
    const read = {
      eq: () => read,
      is: () => read,
      maybeSingle: async () => ({
        data: { id: 'e', ...current },
        error: null,
      }),
    };
    const client = {
      from: () => ({
        select: () => read,
        update: (row: Record<string, unknown>) => {
          writes.push(row);
          const chain = {
            eq: () => chain,
            is: () => chain,
            select: () => chain,
            maybeSingle: async () => ({
              data: { id: 'e', version: current.version + 1, ...row },
              error: null,
            }),
          };
          return chain;
        },
      }),
    };
    return {
      client: client as unknown as Parameters<typeof setStageSkipped>[0],
      writes,
    };
  }

  it('keeps the skipped stages in workspace order, once each', async () => {
    const fake = episodeClient({ skipped_stages: ['shots'], version: 4 });

    await setStageSkipped(fake.client, {
      episodeId: 'e',
      version: 4,
      stage: 'story',
      skipped: true,
    });

    expect(fake.writes[0]).toEqual({ skipped_stages: ['story', 'shots'] });
  });

  it('clears a mark', async () => {
    const fake = episodeClient({
      skipped_stages: ['story', 'shots'],
      version: 4,
    });

    await setStageSkipped(fake.client, {
      episodeId: 'e',
      version: 4,
      stage: 'story',
      skipped: false,
    });

    expect(fake.writes[0]).toEqual({ skipped_stages: ['shots'] });
  });

  it('refuses a version that moved on before writing', async () => {
    const fake = episodeClient({ skipped_stages: [], version: 5 });

    await expect(
      setStageSkipped(fake.client, {
        episodeId: 'e',
        version: 4,
        stage: 'story',
        skipped: true,
      }),
    ).rejects.toBeInstanceOf(OptimisticLockError);
    expect(fake.writes).toHaveLength(0);
  });
});
