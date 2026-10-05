import { vi } from 'vitest';

import type { StorageAdapter } from '@kit/storage';

import { fixtureStorage } from '../../fixtures/edit-package/build-fixture';
import { FIXTURES, seedFixture } from '../../fixtures/edit-package/seed';

/**
 * A fake PostgREST client holding FILM-2001's 20-shot seed, shared by the
 * edit-package loader's tests and deliver_edit's (FILM-2003), which must
 * hand back the same etag get_edit_package computes. `rpc` answers from
 * the map it is given.
 */
export type Row = Record<string, unknown>;

export interface Recorded {
  table: string;
  ranged: boolean;
  ordered: boolean;
}

export function fakeClient(
  tables: Record<string, Row[]>,
  reads: Recorded[] = [],
  rpc: Record<string, (args: Row) => unknown> = {},
) {
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

  return {
    from: builder,
    rpc: async (name: string, args: Row = {}) => ({
      data: rpc[name]?.(args) ?? null,
      error: null,
    }),
  } as never;
}

export function seedTables(fixture: (typeof FIXTURES)[number] = FIXTURES[1]) {
  const seed = seedFixture(fixture);
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

export function spyStorage(seed: ReturnType<typeof seedFixture>) {
  const storage = fixtureStorage(seed.missingKeys);
  const stat = vi.spyOn(storage, 'stat');
  const sign = vi.spyOn(storage, 'getSignedReadUrl');
  return { storage: storage as StorageAdapter, stat, sign };
}

export const readRetention = async () => ({ state: 'unmeasured' as const });
