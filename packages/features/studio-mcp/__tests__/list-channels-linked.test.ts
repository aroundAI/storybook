import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FakeDb,
  type Row,
  callTool,
  contextFor,
  fakeClient,
} from './helpers/fake-postgrest';

/**
 * KB-199: `list_channels(projectId)` lists the project's linked channels —
 * its enabled `project_publishing_configs` rows, the set scheduling accepts —
 * not the channels it has published from. Production had every project's
 * channels linked and nothing published, so the producer saw none.
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const PROJECT = '00000000-0000-4000-8000-0000000000b1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const YOUTUBE = '00000000-0000-4000-8000-0000000000c1';
const FACEBOOK = '00000000-0000-4000-8000-0000000000c2';
const INSTAGRAM = '00000000-0000-4000-8000-0000000000c3';
const OLD_CHANNEL = '00000000-0000-4000-8000-0000000000c4';
const SWITCHED_OFF = '00000000-0000-4000-8000-0000000000c5';

const shared = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => shared.client,
}));

const connection = (id: string, platform: string, name: string): Row => ({
  id,
  account_id: ACCOUNT,
  platform,
  platform_account_name: name,
  is_active: true,
  metadata: {},
  language: 'en',
  scopes: [],
});

const link = (id: string, connectionId: string, enabled = true): Row => ({
  id,
  project_id: PROJECT,
  platform_connection_id: connectionId,
  is_enabled: enabled,
});

function database(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    accounts: [{ id: ACCOUNT, slug: 'team-a', name: 'Team A' }],
    projects: [{ id: PROJECT, account_id: ACCOUNT, name: 'Ledger Autopsy' }],
    platform_connections: [
      connection(YOUTUBE, 'youtube', 'Ledger Autopsy'),
      connection(FACEBOOK, 'facebook', 'Ledger Autopsy FB'),
      connection(INSTAGRAM, 'instagram', 'ledger.autopsy'),
      connection(OLD_CHANNEL, 'youtube', 'Old channel'),
      connection(SWITCHED_OFF, 'youtube', 'Switched off'),
    ],
    project_publishing_configs: [
      link('10000000-0000-4000-8000-000000000001', YOUTUBE),
      link('10000000-0000-4000-8000-000000000002', FACEBOOK),
      link('10000000-0000-4000-8000-000000000003', INSTAGRAM),
      link('10000000-0000-4000-8000-000000000004', SWITCHED_OFF, false),
    ],
    publishes: [],
    ...overrides,
  };
}

const rpc = {
  has_account_access: (args: Record<string, unknown>) =>
    args.p_account_id === ACCOUNT,
};

async function listChannels(db: FakeDb) {
  const client = fakeClient(db, { rpc });
  shared.client = client;
  const { analyticsTools } = await import('../src/server/tools/analytics');
  const result = await callTool(
    analyticsTools,
    'list_channels',
    { projectId: PROJECT },
    contextFor(client, { id: ACCOUNT, slug: 'team-a' }),
  );

  return result.structuredContent.data as Array<{
    connectionId: string;
    linked: boolean;
  }>;
}

describe('list_channels(projectId) (KB-199)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("lists a project's linked channels before anything is published", async () => {
    const channels = await listChannels(database());

    expect(
      channels.map(({ connectionId, linked }) => [connectionId, linked]),
    ).toEqual(
      expect.arrayContaining([
        [YOUTUBE, true],
        [FACEBOOK, true],
        [INSTAGRAM, true],
      ]),
    );
    expect(channels).toHaveLength(3);
  });

  it('flags a channel the project published from that is no longer linked', async () => {
    const channels = await listChannels(
      database({
        publishes: [
          {
            id: '20000000-0000-4000-8000-000000000001',
            status: 'published',
            platform_connection_id: OLD_CHANNEL,
            episodes: { id: EPISODE, project_id: PROJECT },
          },
          {
            id: '20000000-0000-4000-8000-000000000002',
            status: 'published',
            platform_connection_id: YOUTUBE,
            episodes: { id: EPISODE, project_id: PROJECT },
          },
        ],
      }),
    );

    expect(
      Object.fromEntries(
        channels.map(({ connectionId, linked }) => [connectionId, linked]),
      ),
    ).toEqual({
      [YOUTUBE]: true,
      [FACEBOOK]: true,
      [INSTAGRAM]: true,
      [OLD_CHANNEL]: false,
    });
    // Linked first: what the producer can schedule to leads the list.
    expect(channels.at(-1)?.connectionId).toBe(OLD_CHANNEL);
  });

  it('lists no channel for a project with none linked and none published', async () => {
    expect(
      await listChannels(database({ project_publishing_configs: [] })),
    ).toEqual([]);
  });
});
