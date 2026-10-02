import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1906. Every analytics action is a thin wrapper over a service that
 * takes the caller's Supabase client: `action(input)` must call
 * `service(getSupabaseServerClient(), input)` and return what it returns,
 * with nothing added, dropped or re-keyed in between. The MCP tools call the
 * same services with a different client, so a wrapper that quietly reshaped
 * its input or swapped its client would make the page and the tool disagree.
 *
 * One case per split action. The services are mocked; the cookie client is a
 * sentinel object, so the assertion is on identity, not shape.
 */

const { CLIENT, USER, reads, serviceNames, groups } = vi.hoisted(() => {
  const reads: string[] = [];

  /**
   * The cookie-session client. A sentinel for the identity assertions, and
   * a recorder for the two plain-function wrappers whose service cannot be
   * mocked apart from them.
   */
  const CLIENT = {
    sentinel: 'cookie-session client',
    from: (table: string) => {
      reads.push(table);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'is', 'in', 'order']) {
        chain[method] = () => chain;
      }
      chain.range = async () => ({ data: [], error: null });
      return chain;
    },
  };

  const serviceNames = {
    dashboard: [
      'getProjectAnalyticsService',
      'getContentListService',
      'getProjectDailyMetricsService',
      'getProjectRevenueByCurrencyService',
      'getProjectRevenueAccessService',
      'getProjectAudienceDataService',
      'getLanguagePerformanceService',
      'getPlatformLanguageMatrixService',
      'getContentTypeComparisonService',
      'getShortsSourcePerformanceService',
      'getGeographyByLanguageService',
      'getLanguageTrendService',
      'getLanguageDivergenceService',
    ],
    diagnostics: [
      'getWeeklyDiagnosticsService',
      'getRetentionCurveService',
      'getEpisodeAnalyticsService',
      'getEpisodeRetentionPublishService',
    ],
    subscriberSeries: ['getSubscriberSeriesService'],
    videoLog: ['getVideoLogService'],
    sync: ['getSyncStatusService'],
    segment: ['getSegmentPerformanceService'],
    genome: ['getGenomeFindingsService'],
    coverage: ['getCoverageMatrixService'],
    channels: ['listChannelsService'],
    report: [
      'listGeneratedReportsService',
      'getGeneratedReportDownloadService',
      'getScheduledReportsService',
    ],
    settings: ['getAnalyticsSettingsService'],
    publishNotes: ['updatePublishNoteService'],
    revenue: [
      'getRevenueSummaryService',
      'getRevenueProjectionService',
      'getRevenueTimeSeriesService',
      'getTopContentByRevenueService',
    ],
    experiment: [
      'createExperimentService',
      'updateExperimentService',
      'startExperimentService',
      'concludeExperimentService',
      'abandonExperimentService',
      'listExperimentsDueForReviewService',
      'listLinkablePublishesService',
      'listExperimentsService',
      'getExperimentService',
      'deleteExperimentService',
    ],
    channelExperiment: [
      'listChannelExperimentsService',
      'getChannelExperimentService',
      'createChannelExperimentService',
      'startChannelExperimentService',
      'addExperimentStyleService',
      'removeExperimentStyleService',
      'assignExperimentVideoService',
      'unassignExperimentVideoService',
      'listAssignableVideosService',
      'concludeChannelExperimentService',
      'abandonChannelExperimentService',
      'deleteChannelExperimentService',
    ],
    taxonomy: [
      'listTagsService',
      'setPublishTagsService',
      'bulkTagPublishesService',
      'getPublishTagsService',
      'getMedianByTagService',
    ],
    deepDive: [
      'getMedianPerformanceService',
      'getRollingViewsService',
      'getTrafficBreakdownService',
      'getBackCatalogService',
      'getCohortCurvesService',
      'getYppProgressService',
      'getReturningViewerProxyService',
    ],
    signalSurface: ['getSignalSurfaceService'],
  } as const;

  const groups = Object.fromEntries(
    Object.entries(serviceNames).map(([group, names]) => [
      group,
      Object.fromEntries(names.map((name) => [name, vi.fn()])),
    ]),
  ) as Record<
    keyof typeof serviceNames,
    Record<string, ReturnType<typeof vi.fn>>
  >;

  return { CLIENT, USER: { id: 'user-1' }, reads, serviceNames, groups };
});

type Group = keyof typeof serviceNames;

/** A module of `vi.fn()` services, plus a stand-in for every schema export. */
function serviceModule(group: Group) {
  return new Proxy({} as Record<string, unknown>, {
    // A schema the wrapper imports but the mocked `enhanceAction` ignores.
    get: (_target, name: string) =>
      name === '__esModule' ? true : (groups[group][name] ?? {}),
    has: () => true,
  });
}

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (handler: (data: unknown, user: unknown) => unknown) => (data: unknown) =>
      handler(data, USER),
}));

vi.mock('@kit/next/refusals', () => ({
  returnRefusals: (fn: unknown) => fn,
  withRefusals: (_what: string, fn: unknown) => fn,
  requireAffectedRows: () => undefined,
  requireRow: (result: { data: unknown }) => result.data,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => CLIENT,
}));

// What the two plain-function wrappers reach once they have a client; none
// of it is under test here.
vi.mock('@kit/shared/pagination', () => ({
  fetchAllRows: async (build: (from: number, to: number) => unknown) => {
    build(0, 999);
    return [];
  },
  fetchAllByIds: async () => [],
  chunkIds: (ids: string[]) => [ids],
}));
vi.mock('@kit/clickhouse/server', () => ({}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../src/server/revenue-access-reader', () => ({
  readAccountRevenueAccess: async () => [],
}));

// Modules the un-split siblings in the same files pull in; none is called.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../src/server/analytics-sync-cron', () => ({
  syncSinglePublishById: vi.fn(),
}));
vi.mock('../src/server/dim-sync', () => ({ upsertVideoDims: vi.fn() }));
vi.mock('../src/lib/pdf-generator', () => ({ generatePDFReport: vi.fn() }));
vi.mock('../src/lib/csv-generator', () => ({ generateSummaryCSV: vi.fn() }));
vi.mock('../src/server/report-history', () => ({
  deleteGeneratedReportRow: vi.fn(),
  findGeneratedReportPath: vi.fn(),
  recordGeneratedReport: vi.fn(),
}));
vi.mock('../src/server/report-storage', () => ({
  removeReportFile: vi.fn(),
  storeReport: vi.fn(),
}));

vi.mock('../src/server/dashboard-service', () => serviceModule('dashboard'));
vi.mock('../src/server/diagnostics-service', () =>
  serviceModule('diagnostics'),
);
vi.mock('../src/server/subscriber-series-service', () =>
  serviceModule('subscriberSeries'),
);
vi.mock('../src/server/video-log-service', () => serviceModule('videoLog'));
vi.mock('../src/server/sync-service', () => serviceModule('sync'));
vi.mock('../src/server/segment-service', () => serviceModule('segment'));
vi.mock('../src/server/genome-service', () => serviceModule('genome'));
vi.mock('../src/server/coverage-service', () => serviceModule('coverage'));
vi.mock('../src/server/channels-service', () => serviceModule('channels'));
vi.mock('../src/server/report-service', () => serviceModule('report'));
vi.mock('../src/server/settings-service', () => serviceModule('settings'));
vi.mock('../src/server/publish-notes-service', () =>
  serviceModule('publishNotes'),
);
vi.mock('../src/server/revenue-service', () => serviceModule('revenue'));
vi.mock('../src/server/experiment-service', () => serviceModule('experiment'));
vi.mock('../src/server/channel-experiment-service', () =>
  serviceModule('channelExperiment'),
);
vi.mock('../src/server/taxonomy-service', () => serviceModule('taxonomy'));
vi.mock('../src/server/deep-dive-service', () => serviceModule('deepDive'));
vi.mock('../src/server/signal-surface-service', () =>
  serviceModule('signalSurface'),
);

/** The actions module each group's wrappers live in. */
const actionsFile: Record<Group, string> = {
  dashboard: 'dashboard-actions',
  diagnostics: 'diagnostics-actions',
  subscriberSeries: 'subscriber-series-actions',
  videoLog: 'video-log-actions',
  sync: 'sync-actions',
  segment: 'segment-actions',
  genome: 'genome-actions',
  coverage: 'coverage-actions',
  channels: 'channels-actions',
  report: 'report-actions',
  settings: 'settings-actions',
  publishNotes: 'publish-notes-actions',
  revenue: 'revenue-actions',
  experiment: 'experiment-actions',
  channelExperiment: 'channel-experiment-actions',
  taxonomy: 'taxonomy-actions',
  deepDive: 'deep-dive-actions',
  signalSurface: 'signal-surface-actions',
};

/** `[actions module, action, group, service]`: every split action, by name. */
const cases = (Object.keys(serviceNames) as Group[]).flatMap((group) =>
  serviceNames[group].map((service): [string, string, Group, string] => [
    actionsFile[group],
    service.replace(/Service$/, 'Action'),
    group,
    service,
  ]),
);

type ActionsModule = Record<string, unknown>;

const modules: Record<string, () => Promise<ActionsModule>> = {
  'dashboard-actions': () => import('../src/server/dashboard-actions'),
  'diagnostics-actions': () => import('../src/server/diagnostics-actions'),
  'subscriber-series-actions': () =>
    import('../src/server/subscriber-series-actions'),
  'video-log-actions': () => import('../src/server/video-log-actions'),
  'sync-actions': () => import('../src/server/sync-actions'),
  'segment-actions': () => import('../src/server/segment-actions'),
  'genome-actions': () => import('../src/server/genome-actions'),
  'coverage-actions': () => import('../src/server/coverage-actions'),
  'channels-actions': () => import('../src/server/channels-actions'),
  'report-actions': () => import('../src/server/report-actions'),
  'settings-actions': () => import('../src/server/settings-actions'),
  'publish-notes-actions': () => import('../src/server/publish-notes-actions'),
  'revenue-actions': () => import('../src/server/revenue-actions'),
  'experiment-actions': () => import('../src/server/experiment-actions'),
  'channel-experiment-actions': () =>
    import('../src/server/channel-experiment-actions'),
  'taxonomy-actions': () => import('../src/server/taxonomy-actions'),
  'deep-dive-actions': () => import('../src/server/deep-dive-actions'),
  'signal-surface-actions': () =>
    import('../src/server/signal-surface-actions'),
};

async function loadAction(file: string, name: string) {
  const loader = modules[file];
  if (!loader) throw new Error(`no module ../src/server/${file}.ts`);
  const module = await loader();
  const action = module[name];
  if (typeof action !== 'function') {
    throw new Error(`${file} exports no function ${name}`);
  }
  return action as (input: unknown) => Promise<unknown>;
}

describe('every split analytics action delegates to its service', () => {
  beforeEach(() => {
    for (const group of Object.values(groups)) {
      for (const fn of Object.values(group)) fn.mockReset();
    }
  });

  it.each(cases)(
    '%s.%s calls %s.%s with the cookie client and its input, unchanged',
    async (file, actionName, group, serviceName) => {
      const service = groups[group][serviceName]!;
      const input = { marker: `${file}:${actionName}`, nested: { keep: 1 } };
      const result = { from: serviceName };
      service.mockResolvedValue(result);

      const action = await loadAction(file, actionName);

      await expect(action(input)).resolves.toBe(result);

      expect(service).toHaveBeenCalledTimes(1);
      const [client, passed] = service.mock.calls[0]!;
      expect(client).toBe(CLIENT);
      expect(passed).toBe(input);
    },
  );
});

describe('the plain-function wrappers build the cookie client for their service', () => {
  // These two are not server actions, so the page calls them directly; the
  // service lives beside them in the same module and cannot be mocked
  // apart. The cookie client records its reads, and the assertion is that
  // the wrapper's reads reach it.
  beforeEach(() => {
    reads.length = 0;
  });

  it('getAccountDashboardData reads the account through the cookie client', async () => {
    const { getAccountDashboardData } = await import(
      '../src/server/account-dashboard-actions'
    );

    const data = await getAccountDashboardData('account-1');

    expect(reads).toContain('projects');
    expect(data.projectCount).toBe(0);
  });

  it('loadReachOverview reads the connections through the cookie client', async () => {
    const { loadReachOverview } = await import('../src/server/reach-overview');

    const overview = await loadReachOverview({
      accountId: 'account-1',
      window: 30,
      now: new Date('2026-10-01T00:00:00Z'),
    });

    expect(reads).toContain('platform_connections');
    expect(overview.channels).toEqual([]);
  });
});
