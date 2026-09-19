import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listLinkablePublishesAction } from '../src/server/experiment-actions';

/**
 * The video picker searches on the server (FILM-1610 review 3, F5). It used
 * to load every published video in the account on each visit and render
 * each one as a row, which grows without bound with the account.
 */

const calls: {
  ilike: Array<[string, string]>;
  limit: number[];
} = { ilike: [], limit: [] };

let rows: Array<{
  id: string;
  title: string;
  platform: string;
  published_at: string;
}> = [];

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data)),
}));

vi.mock('@kit/clickhouse/server', () => ({}));
vi.mock('../src/server/watched-metric-snapshot', () => ({}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        ilike: (column: string, pattern: string) => {
          calls.ilike.push([column, pattern]);
          return builder;
        },
        limit: async (count: number) => {
          calls.limit.push(count);
          return { data: rows.slice(0, count), error: null };
        },
      };
      return builder;
    },
  }),
}));

const ACCOUNT = '00000000-0000-4000-8000-000000000001';

function video(index: number) {
  return {
    id: `p${index}`,
    title: `Video ${index}`,
    platform: 'youtube',
    published_at: '2026-01-01',
  };
}

beforeEach(() => {
  calls.ilike = [];
  calls.limit = [];
  rows = Array.from({ length: 60 }, (_, index) => video(index));
});

describe('listLinkablePublishesAction', () => {
  it('returns at most 50 and says there are more, instead of loading all', async () => {
    const result = await listLinkablePublishesAction({ accountId: ACCOUNT });

    // One more than the page, to know whether more exist without counting.
    expect(calls.limit).toEqual([51]);
    expect(result.videos).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });

  it('says there are no more when the account has fewer', async () => {
    rows = rows.slice(0, 3);

    const result = await listLinkablePublishesAction({ accountId: ACCOUNT });

    expect(result.videos).toHaveLength(3);
    expect(result.hasMore).toBe(false);
  });

  it('searches titles on the server', async () => {
    await listLinkablePublishesAction({ accountId: ACCOUNT, search: 'Hook' });

    expect(calls.ilike).toEqual([['title', '%Hook%']]);
  });

  it('treats % and _ in a search as the characters, not wildcards', async () => {
    await listLinkablePublishesAction({
      accountId: ACCOUNT,
      search: '50%_off',
    });

    expect(calls.ilike).toEqual([['title', '%50\\%\\_off%']]);
  });

  it('does not filter on a blank search', async () => {
    await listLinkablePublishesAction({ accountId: ACCOUNT, search: '   ' });

    expect(calls.ilike).toEqual([]);
  });
});
