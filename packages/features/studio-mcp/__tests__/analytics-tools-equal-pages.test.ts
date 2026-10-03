import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FakeDb,
  callTool,
  contextFor,
  fakeClient,
} from './helpers/fake-postgrest';

/**
 * FILM-1906, unit test plan: each tool's figures equal the page's for the
 * same seeded scope. The page's action wrapper and the MCP tool are handed
 * the same in-memory database and the same stubbed ClickHouse, so a
 * difference can only come from the tool wiring its service differently
 * from the wrapper — a dropped filter, a date mapped to the wrong field, a
 * different service. One test per area in the spec's table.
 *
 * The tool's result also carries what the page shows beside its figures:
 * the coverage note and, with ClickHouse off, the reason the figures are
 * unmeasured rather than zero (criterion 4).
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ACCOUNT = '00000000-0000-4000-8000-0000000000a2';
const PROJECT = '00000000-0000-4000-8000-0000000000b1';
const SEASON = '00000000-0000-4000-8000-0000000000d1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const PUBLISH_1 = '00000000-0000-4000-8000-0000000000f1';
const PUBLISH_2 = '00000000-0000-4000-8000-0000000000f2';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';
const EXPERIMENT = '00000000-0000-4000-8000-00000000ee01';
const CHANNEL_EXPERIMENT = '00000000-0000-4000-8000-00000000ce01';
const REPORT = '00000000-0000-4000-8000-00000000aa01';
const TAG = '00000000-0000-4000-8000-00000000ab01';
const FROM = '2026-09-01';
const TO = '2026-09-30';

const state = vi.hoisted(() => ({ clickhouse: true }));

vi.mock('../../../next/src/actions/index.ts', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

const shared = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => shared.client,
}));

const TOTALS = {
  views: 350,
  likes: 12,
  comments: 3,
  shares: null,
  saves: null,
  watch_time_seconds: 21_000,
  revenue_cents: null,
  subscribers_gained: 4,
};

const perVideo = (views: number) => ({
  views,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  watch_time_seconds: views * 60,
  revenue_cents: null,
  subscribers_gained: 0,
  measured: {
    shares: false,
    saves: false,
    watch_time_seconds: true,
    subscribers_gained: false,
  },
});

/**
 * Every `query*` export stubbed with a stable answer; the pure helpers
 * (`formatDateStr`, `computeCohortGrowth`, …) stay real. The same stub
 * answers the wrapper and the tool.
 */
// By resolved path: this package does not depend on @kit/clickhouse (the
// lint rule forbids it), so the bare specifier would not resolve from here.
vi.mock('../../../clickhouse/src/server/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed: Record<string, unknown> = { ...actual };

  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== 'function' || !name.startsWith('query')) continue;

    stubbed[name] = async () => {
      if (!state.clickhouse) {
        return /ByVideoIds|ForVideos|Curves$|Levels$|PerVideoTotals|AccountsReached/.test(
          name,
        )
          ? new Map()
          : /WindowDays$/.test(name)
            ? new Set()
            : /Totals$|WatchWindow$/.test(name)
              ? { ...TOTALS, views: null }
              : /ObservedCoverage|Benchmark|VideoDays/.test(name)
                ? null
                : [];
      }

      if (/ByVideoIds|ForVideos|Levels$|PerVideoTotals/.test(name)) {
        return new Map([
          [PUBLISH_1, perVideo(100)],
          [PUBLISH_2, perVideo(250)],
        ]);
      }
      if (/Curves$|AccountsReached/.test(name)) return new Map();
      if (/WindowDays$/.test(name)) return new Set();
      if (/Totals$|WatchWindow$/.test(name)) return TOTALS;
      if (/Benchmark|VideoDays/.test(name)) return null;

      return [];
    };
  }

  return {
    ...stubbed,
    isClickHouseEnabled: () => state.clickhouse,
    queryMedianViewsPerVideo: async () =>
      state.clickhouse
        ? [
            {
              bucket: '2026-09',
              videoCount: 2,
              medianViews: 175,
              p25Views: 100,
              p75Views: 250,
              meanViews: 175,
            },
          ]
        : [],
    queryRetentionCurve: async () =>
      state.clickhouse
        ? [
            { elapsedRatio: 0, audienceWatchRatio: 1 },
            { elapsedRatio: 0.5, audienceWatchRatio: 0.4 },
          ]
        : [],
  };
});

const connection = {
  id: CHANNEL,
  account_id: ACCOUNT,
  platform: 'youtube',
  platform_account_name: 'Seeded Channel',
  is_active: true,
  metadata: {},
  language: 'en',
  scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
  disconnected_at: null,
};

const publish = (id: string, title: string) => ({
  id,
  episode_id: EPISODE,
  platform: 'youtube',
  status: 'published',
  title,
  published_at: '2026-09-10T10:00:00.000Z',
  platform_connection_id: CHANNEL,
  platform_content_id: `yt-${title}`,
  duration_seconds: 600,
  thumbnail_url: null,
  metadata: {},
  analytics_note: null,
  analytics_note_updated_at: null,
  content_type: 'full',
  episodes: {
    id: EPISODE,
    project_id: PROJECT,
    title: 'Episode one',
    thumbnail_url: null,
    projects: { account_id: ACCOUNT },
  },
  platform_connections: {
    scopes: connection.scopes,
    metadata: {},
    disconnected_at: null,
  },
});

function database(): FakeDb {
  return {
    accounts: [{ id: ACCOUNT, slug: 'team-a', name: 'Team A' }],
    projects: [
      { id: PROJECT, account_id: ACCOUNT, name: 'Project A', status: 'active' },
    ],
    seasons: [
      {
        id: SEASON,
        project_id: PROJECT,
        number: 1,
        name: 'S1',
        deleted_at: null,
      },
    ],
    episodes: [
      {
        id: EPISODE,
        project_id: PROJECT,
        season_id: SEASON,
        number: 1,
        title: 'Episode one',
        thumbnail_url: null,
        status: 'published',
        projects: { account_id: ACCOUNT },
      },
    ],
    publishes: [publish(PUBLISH_1, 'one'), publish(PUBLISH_2, 'two')],
    platform_connections: [connection],
    revenue_records: [],
    analytics_experiments: [
      {
        id: EXPERIMENT,
        account_id: ACCOUNT,
        project_id: PROJECT,
        title: 'Faces on thumbnails',
        hypothesis: null,
        status: 'planned',
        outcome_status: 'pending',
        started_at: null,
        ended_at: null,
        created_at: '2026-09-20T00:00:00.000Z',
        metric_watched: 'ctr',
        review_window_days: 30,
        review_due_at: null,
      },
    ],
    experiment_publishes: [],
    experiment_tags: [],
    channel_experiments: [
      {
        id: CHANNEL_EXPERIMENT,
        account_id: ACCOUNT,
        connection_id: CHANNEL,
        title: 'Hook styles',
        status: 'planned',
        format_family: 'short_vertical',
        started_at: null,
        ended_at: null,
        created_at: '2026-09-21T00:00:00.000Z',
      },
    ],
    content_tags: [
      {
        id: TAG,
        account_id: ACCOUNT,
        dimension: 'format',
        slug: 'explainer',
        label: 'Explainer',
      },
    ],
    generated_reports: [
      {
        id: REPORT,
        account_id: ACCOUNT,
        report_type: 'pdf',
        file_name: 'report.pdf',
        storage_path: `${ACCOUNT}/report.pdf`,
        date_range_start: FROM,
        date_range_end: TO,
        record_count: 2,
        config: {},
        created_by: null,
        created_at: '2026-09-30T00:00:00.000Z',
      },
    ],
    scheduled_reports: [],
    analytics_settings: [
      {
        account_id: ACCOUNT,
        ypp_target_watch_hours: 4000,
        ypp_target_subscribers: 1000,
        tag_min_sample: 5,
        settings: {},
      },
    ],
    channel_analytics_settings: [],
    analytics_insights_cache: [
      {
        project_id: PROJECT,
        input_hash: 'h1',
        insights: { insights: [{ title: 'Shorts carry the channel' }] },
        created_at: '2026-09-29T00:00:00.000Z',
      },
    ],
  };
}

const rpc = {
  has_account_access: (args: Record<string, unknown>) =>
    args.p_account_id === ACCOUNT || args.p_account_id === OTHER_ACCOUNT,
  count_tagged_publishes: 2,
  editable_publish_ids: [PUBLISH_1, PUBLISH_2],
};

let client: ReturnType<typeof fakeClient>;
let context: ReturnType<typeof contextFor>;
let tools: Awaited<
  typeof import('../src/server/tools/analytics')
>['analyticsTools'];

beforeEach(async () => {
  state.clickhouse = true;
  client = fakeClient(database(), { rpc });
  shared.client = client;
  context = contextFor(client, { id: ACCOUNT, slug: 'team-a' });
  ({ analyticsTools: tools } = await import('../src/server/tools/analytics'));
});

const data = (result: { structuredContent: Record<string, unknown> }) =>
  result.structuredContent.data;

/** The wrappers' parameter is the schema's output type; the page sends the input shape. */
const unwrap = <T>(result: { ok: boolean; data?: T; error?: string }) => {
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
};

describe('each analytics tool answers what its page answers', () => {
  it('get_account_overview = getAccountDashboardData', async () => {
    const { getAccountDashboardData } = await import(
      '../../content-analytics/src/server/account-dashboard-actions'
    );

    const page = await getAccountDashboardData(ACCOUNT, {
      startDate: new Date(`${FROM}T00:00:00.000Z`),
      endDate: new Date(`${TO}T00:00:00.000Z`),
    });
    const tool = await callTool(
      tools,
      'get_account_overview',
      { from: FROM, to: TO },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(page.totals.views).toBe(350);
    expect(tool.structuredContent.notes).toMatchObject({
      window: { from: FROM, to: TO },
      measured: true,
      reason: null,
    });
  });

  it('get_project_analytics overview = getProjectAnalyticsAction', async () => {
    const { getProjectAnalyticsAction } = await import(
      '../../content-analytics/src/server/dashboard-actions'
    );

    const page = await getProjectAnalyticsAction({
      projectId: PROJECT,
      from: FROM,
      to: TO,
    } as never);
    const tool = await callTool(
      tools,
      'get_project_analytics',
      { projectId: PROJECT, view: 'overview', from: FROM, to: TO },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(page?.totalViews).toBe(350);
  });

  it('get_project_analytics content = getContentListAction, with a platform filter', async () => {
    const { getContentListAction } = await import(
      '../../content-analytics/src/server/dashboard-actions'
    );

    const page = await getContentListAction({
      projectId: PROJECT,
      from: FROM,
      to: TO,
      platforms: ['youtube'],
    } as never);
    const tool = await callTool(
      tools,
      'get_project_analytics',
      {
        projectId: PROJECT,
        view: 'content',
        from: FROM,
        to: TO,
        platform: 'youtube',
      },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_deep_dive median = getMedianPerformanceAction', async () => {
    const { getMedianPerformanceAction } = await import(
      '../../content-analytics/src/server/deep-dive-actions'
    );

    const page = await getMedianPerformanceAction({
      scope: { projectId: PROJECT, connectionId: CHANNEL },
      bucket: 'month',
    } as never);
    const tool = await callTool(
      tools,
      'get_deep_dive',
      {
        view: 'median',
        projectId: PROJECT,
        channelId: CHANNEL,
        bucket: 'month',
      },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(page[0]?.medianViews).toBe(175);
  });

  it('get_deep_dive weekly_diagnostics = getWeeklyDiagnosticsAction', async () => {
    const { getWeeklyDiagnosticsAction } = await import(
      '../../content-analytics/src/server/diagnostics-actions'
    );

    const page = unwrap(
      await getWeeklyDiagnosticsAction({
        scope: { accountId: ACCOUNT },
        sinceDays: 90,
      } as never),
    );
    const tool = await callTool(
      tools,
      'get_deep_dive',
      { view: 'weekly_diagnostics', sinceDays: 90 },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_retention_curve = getRetentionCurveAction', async () => {
    const { getRetentionCurveAction } = await import(
      '../../content-analytics/src/server/diagnostics-actions'
    );

    const page = unwrap(
      await getRetentionCurveAction({ publishId: PUBLISH_1 }),
    );
    const tool = await callTool(
      tools,
      'get_retention_curve',
      { publishId: PUBLISH_1 },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(page.points).toHaveLength(2);
  });

  it('get_video_log = getVideoLogAction', async () => {
    const { getVideoLogAction } = await import(
      '../../content-analytics/src/server/video-log-actions'
    );

    const page = await getVideoLogAction({
      projectId: PROJECT,
      limit: 25,
      offset: 0,
    } as never);
    const tool = await callTool(
      tools,
      'get_video_log',
      { projectId: PROJECT },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_language_analytics performance = getLanguagePerformanceAction', async () => {
    const { getLanguagePerformanceAction } = await import(
      '../../content-analytics/src/server/dashboard-actions'
    );

    const page = await getLanguagePerformanceAction({
      projectId: PROJECT,
      from: FROM,
      to: TO,
      dimension: 'channel',
    } as never);
    const tool = await callTool(
      tools,
      'get_language_analytics',
      {
        projectId: PROJECT,
        view: 'performance',
        from: FROM,
        to: TO,
        dimension: 'channel',
      },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_episode_analytics = getEpisodeAnalyticsAction + getSyncStatusAction', async () => {
    const { getEpisodeAnalyticsAction } = await import(
      '../../content-analytics/src/server/diagnostics-actions'
    );
    const { getSyncStatusAction } = await import(
      '../../content-analytics/src/server/sync-actions'
    );

    const page = unwrap(
      await getEpisodeAnalyticsAction({ episodeId: EPISODE }),
    );
    const sync = unwrap(await getSyncStatusAction({ episodeId: EPISODE }));
    const tool = await callTool(
      tools,
      'get_episode_analytics',
      { episodeId: EPISODE },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(tool.structuredContent.freshness).toEqual(sync);
    expect(tool.structuredContent.retentionPublishId).toBe(PUBLISH_1);
  });

  it('get_video_funnel = getSignalSurfaceAction', async () => {
    const { getSignalSurfaceAction } = await import(
      '../../content-analytics/src/server/signal-surface-actions'
    );

    const page = await getSignalSurfaceAction({
      projectId: PROJECT,
      videoId: PUBLISH_1,
    } as never);
    const tool = await callTool(
      tools,
      'get_video_funnel',
      { projectId: PROJECT, videoId: PUBLISH_1 },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_revenue summary = getRevenueSummaryAction, with the web’s access notes', async () => {
    const { getRevenueSummaryAction } = await import(
      '../../content-analytics/src/server/revenue-actions'
    );
    const { getProjectRevenueAccessAction } = await import(
      '../../content-analytics/src/server/dashboard-actions'
    );

    const page = await getRevenueSummaryAction({
      accountId: ACCOUNT,
      startDate: FROM,
      endDate: TO,
    });
    const access = await getProjectRevenueAccessAction({ projectId: PROJECT });
    const tool = await callTool(
      tools,
      'get_revenue',
      { view: 'summary', projectId: PROJECT, from: FROM, to: TO },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(tool.structuredContent.revenueAccess).toEqual(access);
    expect(access).not.toBeNull();
    expect(access).not.toEqual([]);
  });

  it('get_reach_overview = loadReachOverview', async () => {
    const { loadReachOverview } = await import(
      '../../content-analytics/src/server/reach-overview'
    );

    const now = new Date('2026-09-30T12:00:00.000Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const page = await loadReachOverview({
        accountId: ACCOUNT,
        window: 30,
        now,
      });
      const tool = await callTool(
        tools,
        'get_reach_overview',
        { windowDays: 30 },
        context,
      );

      expect(data(tool)).toEqual(page);
    } finally {
      vi.useRealTimers();
    }
  });

  it('list_experiments = listExperimentsAction, paged', async () => {
    const { listExperimentsAction } = await import(
      '../../content-analytics/src/server/experiment-actions'
    );

    const page = await listExperimentsAction({
      accountId: ACCOUNT,
      projectId: PROJECT,
    });
    const tool = await callTool(
      tools,
      'list_experiments',
      { projectId: PROJECT },
      context,
    );

    expect(tool.structuredContent.items).toEqual(page);
    expect(tool.structuredContent).toMatchObject({
      total: 1,
      nextCursor: null,
    });
  });

  it('get_experiment = getExperimentAction', async () => {
    const { getExperimentAction } = await import(
      '../../content-analytics/src/server/experiment-actions'
    );

    const page = await getExperimentAction({ experimentId: EXPERIMENT });
    const tool = await callTool(
      tools,
      'get_experiment',
      { experimentId: EXPERIMENT },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('list_channel_experiments = listChannelExperimentsAction', async () => {
    const { listChannelExperimentsAction } = await import(
      '../../content-analytics/src/server/channel-experiment-actions'
    );

    const page = await listChannelExperimentsAction({ accountId: ACCOUNT });
    const tool = await callTool(tools, 'list_channel_experiments', {}, context);

    expect(tool.structuredContent.items).toEqual(page);
  });

  it('get_tag_performance tags = listTagsAction', async () => {
    const { listTagsAction } = await import(
      '../../content-analytics/src/server/taxonomy-actions'
    );

    const page = await listTagsAction({
      accountId: ACCOUNT,
      dimension: 'format',
    });
    const tool = await callTool(
      tools,
      'get_tag_performance',
      { view: 'tags', dimension: 'format' },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(page).toHaveLength(1);
  });

  it('get_tag_performance median_by_tag = getMedianByTagAction', async () => {
    const { getMedianByTagAction } = await import(
      '../../content-analytics/src/server/taxonomy-actions'
    );

    const page = await getMedianByTagAction({
      accountId: ACCOUNT,
      projectId: PROJECT,
      dimension: 'format',
    } as never);
    const tool = await callTool(
      tools,
      'get_tag_performance',
      { view: 'median_by_tag', projectId: PROJECT, dimension: 'format' },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_genome_findings = getGenomeFindingsAction', async () => {
    const { getGenomeFindingsAction } = await import(
      '../../content-analytics/src/server/genome-actions'
    );

    const input = {
      connectionId: CHANNEL,
      formatFamily: 'long_horizontal',
      stage: 'hook',
    } as const;
    const page = await getGenomeFindingsAction({
      accountId: ACCOUNT,
      ...input,
    } as never);
    const tool = await callTool(
      tools,
      'get_genome_findings',
      {
        channelId: CHANNEL,
        formatFamily: input.formatFamily,
        stage: input.stage,
      },
      context,
    );

    expect(data(tool)).toEqual(page);
  });

  it('get_data_coverage = getCoverageMatrixAction', async () => {
    const { getCoverageMatrixAction } = await import(
      '../../content-analytics/src/server/coverage-actions'
    );

    const page = await getCoverageMatrixAction({
      scope: { projectId: PROJECT },
      from: FROM,
      to: TO,
    });
    const tool = await callTool(
      tools,
      'get_data_coverage',
      { projectId: PROJECT, from: FROM, to: TO },
      context,
    );

    expect(data(tool)).toEqual(page);
    expect(page.observed).toBe(true);
  });

  it('list_channels = listChannelsAction', async () => {
    const { listChannelsAction } = await import(
      '../../content-analytics/src/server/channels-actions'
    );

    const page = await listChannelsAction({ accountId: ACCOUNT });
    const tool = await callTool(tools, 'list_channels', {}, context);

    expect(data(tool)).toEqual(page);
    expect(page.map((channel) => channel.connectionId)).toEqual([CHANNEL]);
  });

  it('list_reports = listGeneratedReportsAction + getScheduledReportsAction', async () => {
    const { listGeneratedReportsAction, getScheduledReportsAction } =
      await import('../../content-analytics/src/server/report-actions');

    const page = unwrap(
      await listGeneratedReportsAction({
        accountId: ACCOUNT,
        limit: 25,
        offset: 0,
      }),
    );
    const scheduled = await getScheduledReportsAction({ accountId: ACCOUNT });
    const tool = await callTool(tools, 'list_reports', {}, context);

    expect(tool.structuredContent.generated).toEqual({
      items: page.reports,
      nextCursor: null,
    });
    expect(tool.structuredContent.scheduled).toEqual(scheduled);
    expect(page.reports).toHaveLength(1);
  });

  it('get_analytics_settings = getAnalyticsSettingsAction', async () => {
    const { getAnalyticsSettingsAction } = await import(
      '../../content-analytics/src/server/settings-actions'
    );

    const page = await getAnalyticsSettingsAction({ accountId: ACCOUNT });
    const tool = await callTool(tools, 'get_analytics_settings', {}, context);

    expect(data(tool)).toEqual(page);
    expect(page.accountSettings?.ypp_target_watch_hours).toBe(4000);
  });

  it('get_saved_insights reads the project’s cache rows, newest first', async () => {
    const tool = await callTool(
      tools,
      'get_saved_insights',
      { projectId: PROJECT },
      context,
    );

    expect(data(tool)).toEqual([
      {
        inputHash: 'h1',
        generatedAt: '2026-09-29T00:00:00.000Z',
        insights: { insights: [{ title: 'Shorts carry the channel' }] },
      },
    ]);
  });
});

describe('the writes run the page’s service and return its refusals as the contract', () => {
  it('update_publish_note saved = updatePublishNoteAction', async () => {
    const { updatePublishNoteAction } = await import(
      '../../content-analytics/src/server/publish-notes-actions'
    );
    const input = {
      publishId: PUBLISH_1,
      note: 'Thumbnail swapped on day 3',
      expectedUpdatedAt: null,
    };

    const page = unwrap(await updatePublishNoteAction(input));
    const tool = await callTool(tools, 'update_publish_note', input, context);

    expect(tool.structuredContent.result).toEqual(page);
    expect(page.status).toBe('saved');
  });

  it('a refusal the page shows as text is FORBIDDEN with the same words', async () => {
    const { McpToolError } = await import('../src/errors');
    const { updatePublishNoteAction } = await import(
      '../../content-analytics/src/server/publish-notes-actions'
    );

    // The update matches no row and the caller may not edit the note: the
    // service throws an ActionRefusal, which the page shows as text.
    const refusing = fakeClient(
      {
        ...database(),
        publishes: database().publishes!.map((row) => ({
          ...row,
          analytics_note_updated_at: '2026-09-29T00:00:00.000Z',
        })),
      },
      { rpc: { ...rpc, editable_publish_ids: [] } },
    );
    shared.client = refusing;
    const input = { publishId: PUBLISH_1, note: 'x', expectedUpdatedAt: null };

    const page = await updatePublishNoteAction(input);
    const error = await callTool(
      tools,
      'update_publish_note',
      input,
      contextFor(refusing, { id: ACCOUNT, slug: 'team-a' }),
    ).catch((thrown: unknown) => thrown);

    expect(page.ok).toBe(false);
    expect(error).toBeInstanceOf(McpToolError);
    expect((error as InstanceType<typeof McpToolError>).code).toBe('FORBIDDEN');
    expect((error as Error).message).toBe((page as { error: string }).error);
  });
});

describe('with ClickHouse off, a tool answers the page’s state and says why', () => {
  beforeEach(() => {
    state.clickhouse = false;
  });

  it('the account overview has null totals and a reason, never zeros', async () => {
    const tool = await callTool(
      tools,
      'get_account_overview',
      { from: FROM, to: TO },
      context,
    );
    const totals = (data(tool) as { totals: { views: unknown } }).totals;

    expect(totals.views).toBeNull();
    expect(tool.structuredContent.notes).toMatchObject({
      measured: false,
      reason: expect.stringContaining('CLICKHOUSE_ENABLED=false'),
    });
  });

  it('the funnel is analytics_off, as the page’s own state', async () => {
    const tool = await callTool(
      tools,
      'get_video_funnel',
      { projectId: PROJECT, videoId: PUBLISH_1 },
      context,
    );

    expect(data(tool)).toEqual({ status: 'analytics_off' });
    expect(tool.structuredContent.notes).toMatchObject({ measured: false });
  });

  it('the genome refuses with analytics_off', async () => {
    const tool = await callTool(
      tools,
      'get_genome_findings',
      { channelId: CHANNEL, formatFamily: 'long_horizontal', stage: 'hook' },
      context,
    );

    expect(data(tool)).toEqual({
      status: 'refused',
      refusal: { kind: 'analytics_off' },
    });
  });

  it('coverage is not observed', async () => {
    const tool = await callTool(
      tools,
      'get_data_coverage',
      { projectId: PROJECT },
      context,
    );

    expect((data(tool) as { observed: boolean }).observed).toBe(false);
    expect(tool.structuredContent.notes).toMatchObject({ measured: false });
  });

  it('the deep dive series is empty, with the reason beside it', async () => {
    const tool = await callTool(
      tools,
      'get_deep_dive',
      { view: 'median', projectId: PROJECT },
      context,
    );

    expect(data(tool)).toEqual([]);
    expect(tool.structuredContent.notes).toMatchObject({
      measured: false,
      reason: expect.stringContaining('rather than zero'),
    });
  });
});
