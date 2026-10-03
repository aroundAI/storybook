import { beforeEach, describe, expect, it, vi } from 'vitest';

import { McpToolError } from '../src/errors';
import {
  type FakeDb,
  callTool,
  contextFor,
  fakeClient,
} from './helpers/fake-postgrest';

/**
 * FILM-1906, integration test plan as a unit: a token for team A asking for
 * team B's project, account, channel, video, episode, experiment or report
 * gets FORBIDDEN from every tool. Two cases, because they fail at different
 * checks:
 *
 * - The user is a member of both teams. RLS shows B's rows and
 *   `has_account_access` says yes, so the page would answer. The tool must
 *   still refuse: the connection is bound to A (`context.accountId`).
 * - The user is not a member of B. RLS hides the rows; the same answer.
 *
 * The services' ClickHouse reads are stubbed to throw, so a refusal that
 * came after a read would fail the test for the right reason.
 */

const TEAM_A = '00000000-0000-4000-8000-0000000000a1';
const TEAM_B = '00000000-0000-4000-8000-0000000000a2';
const PROJECT_B = '00000000-0000-4000-8000-0000000000b2';
const EPISODE_B = '00000000-0000-4000-8000-0000000000e2';
const PUBLISH_B = '00000000-0000-4000-8000-0000000000f2';
const CHANNEL_B = '00000000-0000-4000-8000-0000000000c2';
const EXPERIMENT_B = '00000000-0000-4000-8000-00000000ee02';
const CHANNEL_EXPERIMENT_B = '00000000-0000-4000-8000-00000000ce02';
const REPORT_B = '00000000-0000-4000-8000-00000000aa02';

const reads = vi.hoisted(() => ({ clickhouse: 0 }));

// By resolved path: this package does not depend on @kit/clickhouse (the
// lint rule forbids it), so the bare specifier would not resolve from here.
vi.mock('../../../clickhouse/src/server/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed: Record<string, unknown> = {
    ...actual,
    isClickHouseEnabled: () => true,
  };

  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === 'function' && name.startsWith('query')) {
      stubbed[name] = async () => {
        reads.clickhouse += 1;
        throw new Error(
          `ClickHouse was read (${name}) before the scope was refused`,
        );
      };
    }
  }

  return stubbed;
});

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => {
    throw new Error('a tool must use the principal client');
  },
}));

function teamBRows(): FakeDb {
  return {
    projects: [
      { id: PROJECT_B, account_id: TEAM_B, name: 'B', status: 'active' },
    ],
    episodes: [
      {
        id: EPISODE_B,
        project_id: PROJECT_B,
        projects: { account_id: TEAM_B },
      },
    ],
    publishes: [
      {
        id: PUBLISH_B,
        episode_id: EPISODE_B,
        platform: 'youtube',
        status: 'published',
        published_at: '2026-09-10T00:00:00.000Z',
        duration_seconds: 600,
        episodes: { project_id: PROJECT_B, projects: { account_id: TEAM_B } },
      },
    ],
    platform_connections: [
      {
        id: CHANNEL_B,
        account_id: TEAM_B,
        platform: 'youtube',
        platform_account_name: 'B channel',
        is_active: true,
        metadata: {},
        language: 'en',
        scopes: [],
        disconnected_at: null,
      },
    ],
    analytics_experiments: [
      { id: EXPERIMENT_B, account_id: TEAM_B, status: 'planned' },
    ],
    channel_experiments: [{ id: CHANNEL_EXPERIMENT_B, account_id: TEAM_B }],
    generated_reports: [
      { id: REPORT_B, account_id: TEAM_B, storage_path: 'b/r.pdf' },
    ],
    content_tags: [],
    analytics_insights_cache: [],
  };
}

/** Every tool that takes an id, with team B's id in it. */
const ASKS: Array<[string, Record<string, unknown>]> = [
  ['get_project_analytics', { projectId: PROJECT_B, view: 'overview' }],
  ['get_deep_dive', { view: 'median', projectId: PROJECT_B }],
  ['get_deep_dive', { view: 'ypp_progress', channelId: CHANNEL_B }],
  ['get_retention_curve', { publishId: PUBLISH_B }],
  ['get_retention_curve', { episodeId: EPISODE_B }],
  ['get_video_log', { projectId: PROJECT_B }],
  ['get_video_log', { channelId: CHANNEL_B }],
  ['get_language_analytics', { projectId: PROJECT_B, view: 'performance' }],
  ['get_episode_analytics', { episodeId: EPISODE_B }],
  ['get_video_funnel', { projectId: PROJECT_B, videoId: PUBLISH_B }],
  ['get_revenue', { view: 'by_currency', projectId: PROJECT_B }],
  ['get_revenue', { view: 'summary', projectId: PROJECT_B }],
  ['list_experiments', { projectId: PROJECT_B }],
  ['get_experiment', { experimentId: EXPERIMENT_B }],
  ['get_channel_experiment', { experimentId: CHANNEL_EXPERIMENT_B }],
  [
    'get_tag_performance',
    { view: 'median_by_tag', projectId: PROJECT_B, dimension: 'format' },
  ],
  ['get_tag_performance', { view: 'segments', channelId: CHANNEL_B }],
  [
    'get_genome_findings',
    { channelId: CHANNEL_B, formatFamily: 'short_vertical', stage: 'hook' },
  ],
  ['get_data_coverage', { projectId: PROJECT_B }],
  ['list_channels', { projectId: PROJECT_B }],
  ['get_report_download', { reportId: REPORT_B }],
  ['get_saved_insights', { projectId: PROJECT_B }],
  ['get_performance_by_origin', { projectId: PROJECT_B }],
  [
    'update_publish_note',
    { publishId: PUBLISH_B, note: 'x', expectedUpdatedAt: null },
  ],
  ['assign_publish_tags', { publishId: PUBLISH_B, tagIds: [] }],
  [
    'create_experiment',
    { projectId: PROJECT_B, title: 't', changeDescription: 'c' },
  ],
  [
    'create_experiment',
    { connectionId: CHANNEL_B, title: 't', changeDescription: 'c' },
  ],
  ['start_experiment', { experimentId: EXPERIMENT_B }],
  [
    'conclude_experiment',
    {
      experimentId: EXPERIMENT_B,
      actualOutcome: 'o',
      outcomeStatus: 'confirmed',
    },
  ],
  ['abandon_experiment', { experimentId: EXPERIMENT_B }],
];

let tools: Awaited<
  typeof import('../src/server/tools/analytics')
>['analyticsTools'];

beforeEach(async () => {
  reads.clickhouse = 0;
  ({ analyticsTools: tools } = await import('../src/server/tools/analytics'));
});

async function refusal(
  db: FakeDb,
  memberOfB: boolean,
  [name, args]: [string, Record<string, unknown>],
) {
  const client = fakeClient(db, {
    rpc: {
      has_account_access: (input: Record<string, unknown>) =>
        input.p_account_id === TEAM_A ||
        (memberOfB && input.p_account_id === TEAM_B),
    },
  });
  const context = contextFor(client, { id: TEAM_A, slug: 'team-a' });

  try {
    const result = await callTool(tools, name, args, context);

    return { code: 'ANSWERED', result };
  } catch (error) {
    if (error instanceof McpToolError)
      return { code: error.code, message: error.message };

    throw error;
  }
}

describe('a token for team A asking for team B', () => {
  it('covers every tool that takes an id', async () => {
    const withIds = tools
      .filter((tool) =>
        Object.keys(tool.inputSchema).some((key) => /Id$|^videoId$/.test(key)),
      )
      .map((tool) => tool.name);

    expect(new Set(ASKS.map(([name]) => name))).toEqual(new Set(withIds));
  });

  it.each(ASKS)(
    'as a member of both teams, %s %j is FORBIDDEN before anything is read',
    async (name, args) => {
      const outcome = await refusal(teamBRows(), true, [name, args]);

      expect(outcome.code).toBe('FORBIDDEN');
      expect(reads.clickhouse).toBe(0);
    },
  );

  it.each(ASKS)(
    'as a non-member, with RLS hiding the rows, %s %j is FORBIDDEN',
    async (name, args) => {
      const outcome = await refusal(
        {
          ...teamBRows(),
          projects: [],
          episodes: [],
          publishes: [],
          platform_connections: [],
          analytics_experiments: [],
          channel_experiments: [],
          generated_reports: [],
        },
        false,
        [name, args],
      );

      expect(outcome.code).toBe('FORBIDDEN');
      expect(reads.clickhouse).toBe(0);
    },
  );
});
