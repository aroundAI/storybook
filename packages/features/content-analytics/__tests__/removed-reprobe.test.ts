import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-213. After the 19 Oct double post, the duplicates were marked removed
 * by hand, but some stayed on the Facebook Page. The hourly sync now asks
 * the platform again, once a day, about a hand-marked removal of the last
 * 14 days: a video still there is published again, a not-found or a failed
 * call leaves it removed.
 */

const metaFetch = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@kit/shared/vendors', () => ({
  metaFetch: (path: string, init: unknown) => metaFetch(path, init),
}));

const { reprobeRemovedPublishes } = await import(
  '../src/server/removed-reprobe'
);

const NOW = new Date('2026-10-20T06:00:00Z');

type Row = Record<string, unknown> & {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
};

const rows = new Map<string, Row>();

function from() {
  const eqs: Array<[string, unknown]> = [];
  let values: Record<string, unknown> | null = null;

  const run = () => {
    const hit = [...rows.values()].filter((row) =>
      eqs.every(([column, value]) => row[column] === value),
    );
    if (values) for (const row of hit) Object.assign(row, values);
    return {
      data: hit.map((row) => structuredClone(row)),
      error: null,
    };
  };

  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      eqs.push([column, value]);
      return q;
    },
    gte: () => q,
    not: () => q,
    order: () => q,
    limit: () => q,
    update: (next: Record<string, unknown>) => {
      values = next;
      return q;
    },
    then: (resolve: (value: unknown) => unknown) => resolve(run()),
  };
  return q;
}

const client = { from } as never;

const youtubeVideoIds = vi.fn();
const deps = {
  ensureValidToken: async () => ({ valid: true, accessToken: 'token' }),
  youtubeVideoIds,
};

function removed(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    status: 'deleted',
    platform: 'facebook',
    platform_content_id: `reel-${id}`,
    platform_connection_id: 'conn-fb',
    published_at: '2026-10-19T21:04:00Z',
    metadata: {
      removedAt: '2026-10-19T09:00:00Z',
      removedReason: 'marked as removed in StoryBook',
    },
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  rows.clear();
  metaFetch.mockReset();
  youtubeVideoIds.mockReset();
});

describe('a video marked removed by hand is asked about again (KB-213)', () => {
  it('publishes again a Facebook reel that is still on the Page', async () => {
    rows.set('dup', removed('dup'));
    metaFetch.mockImplementation(async () => json({ id: 'reel-dup' }));

    const restored = await reprobeRemovedPublishes(client, deps, NOW);

    expect(restored).toEqual(['dup']);
    expect(metaFetch).toHaveBeenCalledWith(
      '/reel-dup?fields=id',
      expect.objectContaining({ token: 'token' }),
    );
    expect(rows.get('dup')).toMatchObject({
      status: 'published',
      metadata: {
        restoredNote:
          'still live on Facebook at 2026-10-20T06:00:00.000Z; it had been marked removed',
      },
    });
    expect(rows.get('dup')!.metadata.removedReason).toBeUndefined();
  });

  it('asks about a row marked removed directly in the database, with no reason', async () => {
    rows.set(
      'sql',
      removed('sql', { metadata: { removedNote: 'KB-207 cleanup' } }),
    );
    metaFetch.mockImplementation(async () => json({ id: 'reel-sql' }));

    expect(await reprobeRemovedPublishes(client, deps, NOW)).toEqual(['sql']);
  });

  it('publishes again a YouTube video the channel still lists', async () => {
    rows.set('yt', removed('yt', { platform: 'youtube' }));
    youtubeVideoIds.mockResolvedValue(new Set(['reel-yt']));

    expect(await reprobeRemovedPublishes(client, deps, NOW)).toEqual(['yt']);
    expect(rows.get('yt')!.status).toBe('published');
  });

  it('leaves it removed on a not-found, and asks again only a day later', async () => {
    rows.set('gone', removed('gone'));
    metaFetch.mockImplementation(async () =>
      json(
        {
          error: {
            code: 100,
            error_subcode: 33,
            message: 'Object does not exist',
          },
        },
        400,
      ),
    );

    expect(await reprobeRemovedPublishes(client, deps, NOW)).toEqual([]);
    expect(rows.get('gone')).toMatchObject({
      status: 'deleted',
      metadata: { reprobedAt: NOW.toISOString() },
    });

    metaFetch.mockClear();
    await reprobeRemovedPublishes(
      client,
      deps,
      new Date(NOW.getTime() + 60 * 60_000),
    );
    expect(metaFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', () => Promise.reject(new Error('fetch failed'))],
    [
      'an expired token',
      async () => json({ error: { code: 190, message: 'expired' } }, 400),
    ],
    [
      'a rate limit',
      async () => json({ error: { code: 4, message: 'too many' } }, 400),
    ],
  ])('changes nothing on %s', async (_name, answer) => {
    rows.set('dup', removed('dup'));
    metaFetch.mockImplementation(answer);

    expect(await reprobeRemovedPublishes(client, deps, NOW)).toEqual([]);
    expect(rows.get('dup')!.status).toBe('deleted');
    expect(rows.get('dup')!.metadata.reprobedAt).toBeUndefined();
  });

  it('does not ask about a removal the platform itself reported', async () => {
    rows.set(
      'auto',
      removed('auto', {
        metadata: { removedReason: 'not found on Facebook' },
      }),
    );

    expect(await reprobeRemovedPublishes(client, deps, NOW)).toEqual([]);
    expect(metaFetch).not.toHaveBeenCalled();
  });
});
