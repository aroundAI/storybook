import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tagScopeRefusal } from '../src/lib/tag-scope';
import {
  bulkTagPublishesAction,
  setPublishTagsAction,
} from '../src/server/taxonomy-actions';

/**
 * KB-98. A tag belongs to one account; linking another account's tag to a
 * video copied its slug into this account's ClickHouse rows. The database
 * refuses the insert (publish_tags_create); these actions name the problem
 * first, and — the part only they can do — before clearing a video's tags.
 */

const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const P_OTHER = '00000000-0000-4000-8000-0000000000c3';
const OWN_TAG = '00000000-0000-4000-8000-0000000000d4';
const OWN_TAG_2 = '00000000-0000-4000-8000-0000000000e5';
const FOREIGN_TAG = '00000000-0000-4000-8000-0000000000f6';

const accountOf = new Map([
  [P1, 'acct-a'],
  [P2, 'acct-a'],
  [P_OTHER, 'acct-b'],
  [OWN_TAG, 'acct-a'],
  [OWN_TAG_2, 'acct-a'],
  [FOREIGN_TAG, 'acct-b'],
]);

describe('tagScopeRefusal', () => {
  const rule = (publishIds: string[], tagIds: string[], visible = accountOf) =>
    tagScopeRefusal({
      publishIds,
      tagIds,
      publishAccounts: new Map(
        publishIds.flatMap((id) =>
          visible.has(id) ? [[id, visible.get(id)!] as const] : [],
        ),
      ),
      tagAccounts: new Map(
        tagIds.flatMap((id) =>
          visible.has(id) ? [[id, visible.get(id)!] as const] : [],
        ),
      ),
    });

  it("allows the videos' own account's tags, and clearing all tags", () => {
    expect(rule([P1, P2], [OWN_TAG, OWN_TAG_2])).toBeNull();
    expect(rule([P1], [])).toBeNull();
  });

  it('refuses a tag from another account, even one the caller can see', () => {
    expect(rule([P1], [OWN_TAG, FOREIGN_TAG])).toBe(
      'Some of these tags belong to another account.',
    );
  });

  it('refuses a tag the caller cannot see', () => {
    const hidden = new Map(accountOf);
    hidden.delete(FOREIGN_TAG);

    expect(rule([P1], [FOREIGN_TAG], hidden)).toBe(
      'Some of these tags belong to another account.',
    );
  });

  it('refuses videos from two accounts in one request', () => {
    expect(rule([P1, P_OTHER], [OWN_TAG])).toMatch(/different accounts/);
  });

  it('refuses a video the caller cannot see', () => {
    const hidden = new Map(accountOf);
    hidden.delete(P1);

    expect(rule([P1], [OWN_TAG], hidden)).toBe(
      'Some of these videos were not found.',
    );
  });
});

const calls: string[] = [];

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  querySegmentPerformance: vi.fn(),
}));

vi.mock('../src/server/dim-sync', () => ({
  upsertVideoDims: async (ids: string[]) => {
    calls.push(`dim-sync ${ids.length}`);
    return ids.length;
  },
}));

/** A read builder: `.in(column, ids)` filters the visible rows; paging returns them. */
function readBuilder(rows: Array<Record<string, unknown>>) {
  let selected = rows;
  const builder = {
    select: () => builder,
    in: (_column: string, ids: string[]) => {
      selected = rows.filter((row) => ids.includes(row.id as string));
      return builder;
    },
    order: () => builder,
    range: async (from: number, to: number) => ({
      data: selected.slice(from, to + 1),
      error: null,
    }),
  };
  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      if (table === 'publishes') {
        return readBuilder(
          [P1, P2, P_OTHER].map((id) => ({
            id,
            episodes: { projects: { account_id: accountOf.get(id) } },
          })),
        );
      }

      if (table === 'content_tags') {
        return readBuilder(
          [OWN_TAG, OWN_TAG_2, FOREIGN_TAG].map((id) => ({
            id,
            account_id: accountOf.get(id),
          })),
        );
      }

      // publish_tags: record every write.
      const write = (verb: string) => {
        calls.push(`publish_tags ${verb}`);
        return {
          eq: async () => ({ error: null }),
          in: async () => ({ error: null }),
          then: (resolve: (value: { error: null }) => void) =>
            resolve({ error: null }),
        };
      };

      return {
        delete: () => write('delete'),
        insert: () => write('insert'),
        upsert: () => write('upsert'),
      };
    },
  }),
}));

describe('tagging actions (KB-98)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("replaces a video's tags with its own account's", async () => {
    const result = await setPublishTagsAction({
      publishId: P1,
      tagIds: [OWN_TAG],
    });

    expect(result).toEqual({ ok: true, data: { success: true, tagCount: 1 } });
    expect(calls).toEqual([
      'publish_tags delete',
      'publish_tags insert',
      'dim-sync 1',
    ]);
  });

  it("refuses another account's tag without clearing the video's tags", async () => {
    const result = await setPublishTagsAction({
      publishId: P1,
      tagIds: [OWN_TAG, FOREIGN_TAG],
    });

    expect(result).toEqual({
      ok: false,
      error: 'Some of these tags belong to another account.',
    });
    expect(calls).toEqual([]);
  });

  it('refuses a bulk replace with a foreign tag before clearing anything', async () => {
    const result = await bulkTagPublishesAction({
      publishIds: [P1, P2],
      tagIds: [FOREIGN_TAG],
      replace: true,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Some of these tags belong to another account.',
    });
    expect(calls).toEqual([]);
  });

  it('refuses a bulk tag across two accounts', async () => {
    const result = await bulkTagPublishesAction({
      publishIds: [P1, P_OTHER],
      tagIds: [OWN_TAG],
      replace: false,
    });

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('bulk-tags videos of one account with its tags', async () => {
    const result = await bulkTagPublishesAction({
      publishIds: [P1, P2],
      tagIds: [OWN_TAG, OWN_TAG_2],
      replace: true,
    });

    expect(result).toEqual({
      ok: true,
      data: { success: true, publishCount: 2 },
    });
    expect(calls).toEqual([
      'publish_tags delete',
      'publish_tags upsert',
      'dim-sync 2',
    ]);
  });
});
