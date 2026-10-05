import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { FIXTURES, FIXTURE_PUBLIC_PREFIX } from '../fixtures/edit-package/seed';
import { EditPackageSchema, type MediaEntry } from '../src/edit-package.schema';
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

/**
 * KB-189: each file's SHA-256 is recorded where it is written
 * (`media_checksums`, keyed by bucket and storage key). The loader reads the
 * project's rows for the keys the package names, so every listed file that
 * has one carries it, and the etag moves when one is recorded.
 */
describe('recorded checksums (KB-189)', () => {
  const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  /** The bucket and key a fixture URL names. */
  function keyOf(url: string) {
    const [bucket, ...rest] = url
      .slice(FIXTURE_PUBLIC_PREFIX.length + 1)
      .split('/');
    return { bucket: bucket!, object_key: rest.join('/') };
  }

  /** Every media entry in a package, by its `bucket/key`. */
  function entriesByKey(value: unknown, found = new Map<string, MediaEntry>()) {
    if (Array.isArray(value)) {
      value.forEach((item) => entriesByKey(item, found));
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.key === 'string' && 'url' in record) {
        found.set(record.key, record as unknown as MediaEntry);
      }
      Object.values(record).forEach((item) => entriesByKey(item, found));
    }
    return found;
  }

  function writtenMedia(seed: ReturnType<typeof seedTables>['seed']) {
    const { sources } = seed;
    const assetUrl = new Map(
      sources.audioAssets.map((a) => [a.id, a.file_url]),
    );
    const urls = {
      'shot video': sources.shots.find((s) => s.video_url)!.video_url!,
      'shot frame': sources.shots.find((s) => s.first_frame_url)!
        .first_frame_url!,
      'dialogue line': sources.dialogueLines.find((d) => d.audio_url)!
        .audio_url!,
      'music or SFX track': sources.audioTracks
        .map((t) => t.file_url ?? assetUrl.get(t.audio_asset_id ?? '') ?? null)
        .find(Boolean)!,
      'dubbed line': sources.dubbedLines.find((l) => l.audio_url)!.audio_url!,
      'character reference image':
        sources.characterDetails[0]!.reference_images![0]!,
    };

    return Object.entries(urls).filter(
      ([, url]) =>
        !seed.missingKeys.has(url.slice(FIXTURE_PUBLIC_PREFIX.length + 1)),
    );
  }

  it('every listed file with a recorded checksum carries it', async () => {
    const { seed, tables } = seedTables(FIXTURES[2]);
    const media = writtenMedia(seed);
    const checksums = media.map(([, url]) => ({
      ...keyOf(url),
      project_id: seed.sources.project.id,
      sha256: digest(`bytes of ${url}`),
    }));

    const result = await getEditPackage(
      fakeClient({ ...tables, media_checksums: checksums }),
      {
        accountId: seed.accountId,
        episodeId: seed.sources.episode.id,
        storage: spyStorage(seed).storage,
        readRetention,
      },
    );
    if (result.status !== 'package') throw new Error(result.status);

    const entries = entriesByKey(result.editPackage);
    expect(media.map(([label]) => label)).toHaveLength(6);

    for (const [label, url] of media) {
      const { bucket, object_key } = keyOf(url);
      expect(
        entries.get(`${bucket}/${object_key}`),
        `${label} carries its recorded SHA-256`,
      ).toMatchObject({ sha256: digest(`bytes of ${url}`) });
    }
  });

  it('ignores another project’s row for the same key', async () => {
    const { seed, tables } = seedTables(FIXTURES[2]);
    const [, url] = writtenMedia(seed)[0]!;
    const { bucket, object_key } = keyOf(url);

    const result = await getEditPackage(
      fakeClient({
        ...tables,
        media_checksums: [
          {
            bucket,
            object_key,
            project_id: '00000000-0000-4000-8000-000000000000',
            sha256: digest('forged'),
          },
        ],
      }),
      {
        accountId: seed.accountId,
        episodeId: seed.sources.episode.id,
        storage: spyStorage(seed).storage,
        readRetention,
      },
    );
    if (result.status !== 'package') throw new Error(result.status);

    expect(
      entriesByKey(result.editPackage).get(`${bucket}/${object_key}`),
    ).toMatchObject({ sha256: null, sha256Reason: 'not_recorded' });
  });

  it('the etag moves when a checksum is recorded, and deliver_edit computes the same one', async () => {
    const { seed, tables } = seedTables(FIXTURES[2]);
    const [, url] = writtenMedia(seed)[0]!;
    const scope = {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      storage: spyStorage(seed).storage,
    };
    const recorded = {
      ...tables,
      media_checksums: [
        {
          ...keyOf(url),
          project_id: seed.sources.project.id,
          sha256: digest(url),
        },
      ],
    };

    const before = await currentEditPackageEtag(fakeClient(tables), scope);
    const after = await currentEditPackageEtag(fakeClient(recorded), scope);
    const served = await getEditPackage(fakeClient(recorded), {
      ...scope,
      readRetention,
    });

    expect(after).not.toBe(before);
    expect(served.status === 'package' && served.editPackage.etag).toBe(after);
  });

  it('asks for the keys in chunks small enough for a request URI', async () => {
    const { seed, tables } = seedTables(FIXTURES[2]);
    const lists: string[][] = [];
    const client = fakeClient(tables) as unknown as {
      from: (table: string) => { in: (c: string, v: string[]) => unknown };
    };
    const from = client.from;
    client.from = (table: string) => {
      const builder = from(table);
      if (table !== 'media_checksums') return builder;
      const original = builder.in;
      builder.in = (column: string, values: string[]) => {
        lists.push(values);
        return original(column, values);
      };
      return builder;
    };

    await currentEditPackageEtag(client as never, {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
      storage: spyStorage(seed).storage,
    });

    expect(lists.length).toBeGreaterThan(1);
    expect(
      Math.max(...lists.map((l) => encodeURI(l.join(',')).length)),
    ).toBeLessThan(6000);
  });
});
