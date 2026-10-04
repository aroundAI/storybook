import { describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '@kit/storage';

import { fixtureStorage } from '../fixtures/edit-package/build-fixture';
import { FIXTURES, seedFixture } from '../fixtures/edit-package/seed';
import { EditPackageSchema } from '../src/edit-package.schema';
import { getEditPackage } from '../src/server/load-edit-package';

vi.mock('@kit/content-analytics/server/diagnostics-service', () => ({
  getEpisodeRetentionCurveService: vi.fn(async () => {
    throw new Error('the default analytics read must not run in these tests');
  }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

/**
 * FILM-2001: the loader over a fake PostgREST client holding the 20-shot
 * seed. What it proves: the etag is compared before anything is signed,
 * an episode the client cannot see is `not_found`, every list read is
 * paged with a deterministic order, and the result validates.
 */

type Row = Record<string, unknown>;

interface Recorded {
  table: string;
  ranged: boolean;
  ordered: boolean;
}

function fakeClient(tables: Record<string, Row[]>, reads: Recorded[] = []) {
  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const read: Recorded = { table, ranged: false, ordered: false };
    let range: [number, number] | null = null;

    const run = () => {
      reads.push(read);
      const rows = (tables[table] ?? []).filter((row) =>
        filters.every((f) => f(row)),
      );
      return range ? rows.slice(range[0], range[1] + 1) : rows;
    };

    const chain = {
      select: () => chain,
      eq(column: string, value: unknown) {
        filters.push((row) =>
          column.includes('.')
            ? (row[column.split('.')[0]!] as Row)[column.split('.')[1]!] ===
              value
            : row[column] === value,
        );
        return chain;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      not(column: string) {
        filters.push(
          (row) => row[column] !== null && row[column] !== undefined,
        );
        return chain;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      order() {
        read.ordered = true;
        return chain;
      },
      range(from: number, to: number) {
        read.ranged = true;
        range = [from, to];
        return chain;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: run(), error: null }).then(resolve);
      },
    };

    return chain;
  }

  return { from: builder } as never;
}

function seedTables() {
  const seed = seedFixture(FIXTURES[1]);
  const { sources } = seed;
  const with_ = (rows: object[], extra: Row): Row[] =>
    rows.map((row) => ({ ...row, ...extra }));

  return {
    seed,
    tables: {
      episodes: [
        {
          ...sources.episode,
          deleted_at: null,
          project: { ...sources.project, account_id: seed.accountId },
        },
      ],
      shots: with_(sources.shots, {
        episode_id: sources.episode.id,
        deleted_at: null,
      }),
      dialogue_lines: with_(sources.dialogueLines, {
        episode_id: sources.episode.id,
      }),
      audio_tracks: with_(sources.audioTracks, {
        episode_id: sources.episode.id,
      }),
      audio_assets: with_(sources.audioAssets, {
        project_id: sources.project.id,
      }),
      captions: with_(sources.captions, { episode_id: sources.episode.id }),
      caption_segments: with_(sources.captionSegments, {}),
      assets: [
        ...with_(sources.characters, {
          project_id: sources.project.id,
          type: 'character',
          deleted_at: null,
          file_hash: null,
        }).map((row) => ({
          ...row,
          file_hash: sources.recordedHashes[row.file_url as string] ?? null,
        })),
      ],
      character_details: with_(sources.characterDetails, {}),
      shorts: with_(sources.shorts, { episode_id: sources.episode.id }),
      dubbed_versions: with_(sources.dubbedVersions, {
        episode_id: sources.episode.id,
      }),
      dubbed_dialogue_lines: with_(sources.dubbedLines, {}),
    } satisfies Record<string, Row[]>,
  };
}

function spyStorage(seed: ReturnType<typeof seedFixture>) {
  const storage = fixtureStorage(seed.missingKeys);
  const stat = vi.spyOn(storage, 'stat');
  const sign = vi.spyOn(storage, 'getSignedReadUrl');
  return { storage: storage as StorageAdapter, stat, sign };
}

const readRetention = async () => ({ state: 'unmeasured' as const });

describe('getEditPackage', () => {
  it('returns a schema-valid package with every list paged and ordered', async () => {
    const { seed, tables } = seedTables();
    const reads: Recorded[] = [];
    const { storage } = spyStorage(seed);

    const result = await getEditPackage(fakeClient(tables, reads), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      storage,
      readRetention,
    });

    expect(result.status).toBe('package');
    if (result.status !== 'package') return;

    expect(EditPackageSchema.safeParse(result.editPackage).success).toBe(true);
    expect(result.editPackage.shots).toHaveLength(20);
    expect(result.editPackage.captions[0]!.segments).toHaveLength(40);

    const lists = reads.filter((r) => r.table !== 'episodes');
    expect(lists.length).toBeGreaterThanOrEqual(11);
    expect(lists.filter((r) => !r.ranged || !r.ordered)).toEqual([]);
  });

  it('answers unchanged for the current etag without signing or reading analytics', async () => {
    const { seed, tables } = seedTables();
    const first = spyStorage(seed);
    const full = await getEditPackage(fakeClient(tables), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      storage: first.storage,
      readRetention,
    });
    const etag = full.status === 'package' ? full.editPackage.etag : '';

    const again = spyStorage(seed);
    const retention = vi.fn(readRetention);
    const result = await getEditPackage(fakeClient(tables), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      ifNoneMatch: etag,
      storage: again.storage,
      readRetention: retention,
    });

    expect(result).toEqual({ status: 'unchanged', etag });
    expect(again.stat).not.toHaveBeenCalled();
    expect(again.sign).not.toHaveBeenCalled();
    expect(retention).not.toHaveBeenCalled();
  });

  it('returns the full package for a stale etag', async () => {
    const { seed, tables } = seedTables();
    const result = await getEditPackage(fakeClient(tables), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      ifNoneMatch: 'v6-0000000000000000000000000000000000000000',
      storage: spyStorage(seed).storage,
      readRetention,
    });

    expect(result.status).toBe('package');
  });

  it('is not_found for another team’s episode, before any media is touched', async () => {
    const { seed, tables } = seedTables();
    const { storage, stat } = spyStorage(seed);

    const result = await getEditPackage(fakeClient(tables), {
      accountId: '00000000-0000-4000-8000-000000000000',
      episodeId: seed.sources.episode.id,
      storage,
      readRetention,
    });

    expect(result).toEqual({ status: 'not_found' });
    expect(stat).not.toHaveBeenCalled();
  });

  it('still opens when analytics cannot be read, and says so', async () => {
    const { seed, tables } = seedTables();
    const result = await getEditPackage(fakeClient(tables), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      storage: spyStorage(seed).storage,
      readRetention: async () => {
        throw new Error('ClickHouse timed out');
      },
    });

    expect(
      result.status === 'package' && result.editPackage.analyticsHints,
    ).toEqual({ retention: [], publishId: null, reason: 'unavailable' });
  });
});
