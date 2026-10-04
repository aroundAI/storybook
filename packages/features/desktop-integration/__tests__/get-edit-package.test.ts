import { describe, expect, it, vi } from 'vitest';

import { EditPackageSchema } from '../src/edit-package.schema';
import {
  currentEditPackageEtag,
  getEditPackage,
} from '../src/server/load-edit-package';
import {
  type Recorded,
  fakeClient,
  readRetention,
  seedTables,
  spyStorage,
} from './helpers/edit-package-db';

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

  it('currentEditPackageEtag is the etag get_edit_package returns, and null when unseen', async () => {
    const { seed, tables } = seedTables();
    const full = await getEditPackage(fakeClient(tables), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      storage: spyStorage(seed).storage,
      readRetention,
    });

    expect(
      await currentEditPackageEtag(fakeClient(tables), {
        accountId: seed.accountId,
        episodeId: seed.sources.episode.id,
      }),
    ).toBe(full.status === 'package' ? full.editPackage.etag : 'none');
    expect(
      await currentEditPackageEtag(fakeClient(tables), {
        accountId: '00000000-0000-4000-8000-000000000000',
        episodeId: seed.sources.episode.id,
      }),
    ).toBeNull();
  });
});
