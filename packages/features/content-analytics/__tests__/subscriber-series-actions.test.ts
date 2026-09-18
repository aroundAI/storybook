import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSubscriberSeriesAction } from '../src/server/subscriber-series-actions';

const projectId = '00000000-0000-4000-8000-0000000000a1';
const myAccount = '00000000-0000-4000-8000-0000000000b1';
const theirAccount = '00000000-0000-4000-8000-0000000000b2';

const inProject = '00000000-0000-4000-8000-0000000000c1';
const inProjectInactive = '00000000-0000-4000-8000-0000000000c2';
const outsideProject = '00000000-0000-4000-8000-0000000000c3';
const theirs = '00000000-0000-4000-8000-0000000000d1';

// Every connection in the database, across tenants. The admin client reads
// this table with no RLS, so whatever filters the action applies are the only
// thing between a caller and another account's channels.
const table = [
  { id: inProject, account_id: myAccount, is_active: true },
  { id: inProjectInactive, account_id: myAccount, is_active: false },
  { id: outsideProject, account_id: myAccount, is_active: true },
  { id: theirs, account_id: theirAccount, is_active: true },
];

const channelRef = (connectionId: string, isActive: boolean) => ({
  connectionId,
  platform: 'youtube',
  name: connectionId,
  thumbnailUrl: null,
  isActive,
});

const mocks = vi.hoisted(() => ({
  assertScopeAccess: vi.fn(),
  listProjectChannels: vi.fn(),
  querySubscriberSeries: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));

type Row = (typeof table)[number];

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: () => {
      const filters: Array<(row: Row) => boolean> = [];

      const query = {
        select: () => query,
        eq: (column: keyof Row, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        in: (column: keyof Row, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        order: () => query,
        range: async () => ({
          data: table
            .filter((row) => filters.every((f) => f(row)))
            .map(({ id }) => ({ id })),
          error: null,
        }),
      };

      return query;
    },
  }),
}));

vi.mock('@kit/shared/pagination', () => ({
  fetchAllRows: async (
    page: (
      from: number,
      to: number,
    ) => Promise<{ data: unknown[] | null; error: unknown }>,
  ) => (await page(0, 999)).data ?? [],
}));

vi.mock('@kit/clickhouse/server', () => ({
  querySubscriberSeries: mocks.querySubscriberSeries,
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: mocks.assertScopeAccess,
}));

vi.mock('../src/server/channels', () => ({
  listProjectChannels: mocks.listProjectChannels,
}));

const window = { from: '2026-01-01', to: '2026-01-31' };

async function seriesConnectionIds(scope: Record<string, string>) {
  const result = await getSubscriberSeriesAction({ scope, ...window });
  return result.map((s) => s.connectionId).sort();
}

describe('getSubscriberSeriesAction scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.assertScopeAccess.mockResolvedValue(myAccount);
    mocks.listProjectChannels.mockResolvedValue([
      channelRef(inProject, true),
      channelRef(inProjectInactive, false),
    ]);
    mocks.querySubscriberSeries.mockImplementation(
      async ({ connectionIds }: { connectionIds: string[] }) =>
        connectionIds.map((connectionId) => ({
          connectionId,
          points: [],
          roundingStep: 0,
        })),
    );
  });

  it("returns only the project's channels for a project scope", async () => {
    await expect(seriesConnectionIds({ projectId })).resolves.toEqual(
      [inProject, inProjectInactive].sort(),
    );
  });

  // assertScopeAccess proves the project is the caller's and ignores the
  // extra id. Filtering on the caller-supplied account would read theirs.
  it('ignores a caller-supplied account that is not the project account', async () => {
    await expect(
      seriesConnectionIds({ projectId, accountId: theirAccount }),
    ).resolves.toEqual([inProject, inProjectInactive].sort());
  });

  // Matches the FILM-1611 channel filter, which lists disconnected channels:
  // selecting one should show its history, not an empty card.
  it('includes a project channel that has since been disconnected', async () => {
    await expect(
      seriesConnectionIds({ projectId, connectionId: inProjectInactive }),
    ).resolves.toEqual([inProjectInactive]);
  });

  it('narrows a project scope to the selected channel', async () => {
    await expect(
      seriesConnectionIds({ projectId, connectionId: inProject }),
    ).resolves.toEqual([inProject]);
  });

  it("returns the verified account's active channels for an account scope", async () => {
    await expect(
      seriesConnectionIds({ accountId: myAccount }),
    ).resolves.toEqual([inProject, outsideProject].sort());
  });

  it('reads nothing when access is denied', async () => {
    mocks.assertScopeAccess.mockRejectedValue(
      new Error('Project not found or access denied'),
    );

    await expect(
      getSubscriberSeriesAction({ scope: { projectId }, ...window }),
    ).rejects.toThrow('Project not found or access denied');

    expect(mocks.listProjectChannels).not.toHaveBeenCalled();
    expect(mocks.querySubscriberSeries).not.toHaveBeenCalled();
  });
});
