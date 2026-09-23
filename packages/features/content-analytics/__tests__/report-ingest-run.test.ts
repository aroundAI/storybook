import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `runReportingIngestJob` end to end, with the vendor, Postgres and the
 * ClickHouse writers replaced (FILM-1504).
 *
 * The vendor is a fake serving the fixture CSVs — never the real YouTube
 * API. Postgres is an in-memory `youtube_report_jobs` plus a fixed publish
 * lookup. The ClickHouse writers are spies, so each test asserts which
 * table a report's rows were sent to, which is where the residual clobber
 * lived. What ClickHouse then does with them is `report-ingest.local-stack`
 * and CI's `verify`.
 */

const CONNECTION = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
const PUBLISH_A = '33333333-3333-3333-3333-333333333333';
const PUBLISH_X = '44444444-4444-4444-4444-444444444444';
const DAY = '2026-09-10';

const writers = vi.hoisted(() => ({
  insertChannelDaily: vi.fn(async () => undefined),
  insertChannelReachDaily: vi.fn(async () => undefined),
  insertVideoMetrics: vi.fn(async () => undefined),
  insertVideoReachDaily: vi.fn(async () => undefined),
  insertVideoTrafficSources: vi.fn(async () => undefined),
  isClickHouseEnabled: vi.fn(() => true),
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

interface JobRecord {
  id: string;
  platform_connection_id: string;
  report_type_id: string;
  youtube_job_id: string;
  last_report_created_after: string | null;
  status: string;
}

const db = vi.hoisted(() => ({
  jobs: [] as JobRecord[],
  watermarkWrites: [] as Array<{ id: string; value: string }>,
  failWatermarkWrite: false,
  /** YouTube video id → publish id; the rest are unmatched. */
  matched: new Map<string, string>(),
}));

interface FakeReport {
  reportId: string;
  createTime: string;
  startTime: string;
  endTime: string;
  downloadUrl: string;
}

const vendor = vi.hoisted(() => ({
  reports: new Map<string, FakeReport[]>(),
  files: new Map<string, string>(),
  downloads: [] as string[],
}));

vi.mock('@kit/clickhouse/server', () => writers);

vi.mock('@kit/shared/logger', () => ({ getLogger: async () => logger }));

vi.mock('@kit/publishing/token-refresh', () => ({
  ensureValidToken: async () => ({ valid: true, accessToken: 'fake-token' }),
}));

vi.mock('@kit/shared/pagination', () => ({
  fetchAllRows: async () => [{ id: CONNECTION, account_id: 'account' }],
  fetchAllByIds: async (ids: string[]) =>
    ids
      .filter((id) => db.matched.has(id))
      .map((id) => ({
        id: db.matched.get(id),
        platform_content_id: id,
        episodes: { project_id: PROJECT },
      })),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'youtube_report_jobs') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => {
          const filters: Record<string, string> = {};
          const query = {
            eq(column: string, value: string) {
              filters[column] = value;
              return query;
            },
            then(
              resolve: (value: { data: JobRecord[]; error: null }) => unknown,
            ) {
              return Promise.resolve({
                data: db.jobs.filter(
                  (job) =>
                    job.platform_connection_id ===
                      filters.platform_connection_id &&
                    job.status === filters.status,
                ),
                error: null,
              }).then(resolve);
            },
          };
          return query;
        },
        upsert: (row: Omit<JobRecord, 'id' | 'last_report_created_after'>) => ({
          select: () => ({
            single: async () => {
              let job = db.jobs.find(
                (j) =>
                  j.platform_connection_id === row.platform_connection_id &&
                  j.report_type_id === row.report_type_id,
              );
              if (!job) {
                job = {
                  id: `row-${row.report_type_id}`,
                  last_report_created_after: null,
                  ...row,
                };
                db.jobs.push(job);
              }
              return { data: job, error: null };
            },
          }),
        }),
        update: (values: { last_report_created_after: string }) => ({
          eq: async (_column: string, id: string) => {
            if (db.failWatermarkWrite) {
              return { error: { message: 'connection reset' } };
            }
            db.watermarkWrites.push({
              id,
              value: values.last_report_created_after,
            });
            const job = db.jobs.find((j) => j.id === id)!;
            job.last_report_created_after = values.last_report_created_after;
            return { error: null };
          },
        }),
      };
    },
  }),
}));

vi.mock('../src/providers/youtube/youtube-reporting', () => ({
  YOUTUBE_REPORT_TYPES: [
    'channel_basic_a3',
    'channel_combined_a3',
    'channel_traffic_source_a3',
    'channel_reach_combined_a1',
  ],
  createYouTubeReportingProvider: () => ({
    listReportTypes: async () => [
      'channel_basic_a3',
      'channel_combined_a3',
      'channel_traffic_source_a3',
      'channel_reach_combined_a1',
    ],
    listJobs: async () => [],
    createJob: async (reportTypeId: string) => ({
      jobId: `job-${reportTypeId}`,
      reportTypeId,
    }),
    // YouTube's createdAfter filter, taken as strict: a report created at
    // exactly the watermark is not listed again.
    listReports: async (jobId: string, createdAfter?: string) =>
      (vendor.reports.get(jobId) ?? []).filter(
        (report) => !createdAfter || report.createTime > createdAfter,
      ),
    downloadReport: async (url: string) => {
      vendor.downloads.push(url);
      return vendor.files.get(url) ?? '';
    },
  }),
}));

const { runReportingIngestJob } = await import(
  '../src/server/reporting/report-ingest'
);

const FIXTURES = join(import.meta.dirname, 'fixtures', 'youtube-reporting');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.csv`), 'utf8');
}

/** Queue one report for a job, served from `csv`. */
function deliver(
  reportType: string,
  csv: string,
  createTime: string,
  reportId = `${reportType}-${createTime}-${vendor.files.size}`,
) {
  const url = `https://fake.invalid/v1/media/${reportId}?alt=media`;
  const jobId = `job-${reportType}`;

  vendor.files.set(url, csv);
  vendor.reports.set(jobId, [
    ...(vendor.reports.get(jobId) ?? []),
    {
      reportId,
      createTime,
      startTime: `${DAY}T00:00:00Z`,
      endTime: `${DAY}T23:59:59Z`,
      downloadUrl: url,
    },
  ]);
}

function watermarkOf(reportType: string): string | null {
  return (
    db.jobs.find((job) => job.report_type_id === reportType)
      ?.last_report_created_after ?? null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  writers.isClickHouseEnabled.mockReturnValue(true);
  db.jobs = [];
  db.watermarkWrites = [];
  db.failWatermarkWrite = false;
  db.matched = new Map([['vidA', PUBLISH_A]]);
  vendor.reports = new Map();
  vendor.files = new Map();
  vendor.downloads = [];
});

describe('runReportingIngestJob — the channel residual', () => {
  it('writes the reach residual to channel_reach_daily and never over channel_daily', async () => {
    // Core first, reach second: the order they usually arrive in, and the
    // one where the reach row's zeroes used to erase watch time.
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');
    deliver(
      'channel_reach_combined_a1',
      fixture('channel_reach_combined_a1'),
      '2026-09-12T02:00:00Z',
    );

    await runReportingIngestJob();

    expect(writers.insertChannelDaily).toHaveBeenCalledTimes(1);
    expect(writers.insertChannelDaily).toHaveBeenCalledWith([
      {
        connection_id: CONNECTION,
        metric_date: DAY,
        views: 400,
        watch_time_seconds: 1800,
        engaged_views: 330,
        subscribers_gained: 3,
        subscribers_lost: 1,
      },
    ]);

    expect(writers.insertChannelReachDaily).toHaveBeenCalledTimes(1);
    const [reachResidual] = writers.insertChannelReachDaily.mock.calls[0]! as [
      Array<Record<string, unknown>>,
    ];
    expect(reachResidual).toHaveLength(1);
    expect(reachResidual[0]).toMatchObject({
      connection_id: CONNECTION,
      metric_date: DAY,
      impressions: 4000,
    });
    // (0.04 × 1000 + 0.06 × 3000) / 4000
    expect(reachResidual[0]!.impressions_ctr).toBeCloseTo(0.055, 9);

    expect(writers.insertVideoReachDaily).toHaveBeenCalledWith([
      expect.objectContaining({
        video_id: PUBLISH_A,
        impressions: 4000,
      }),
    ]);
  });

  // A redelivered day where every video now matches a publish must replace
  // the residual it wrote before — with a measured zero. Writing nothing
  // leaves the old residual standing, so the video is counted twice: once
  // in video_metrics and once in channel_daily.
  it('writes a zero residual for a reported day on which every video matched', async () => {
    db.matched = new Map([
      ['vidA', PUBLISH_A],
      ['vidX', PUBLISH_X],
    ]);
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');
    deliver(
      'channel_reach_combined_a1',
      fixture('channel_reach_combined_a1'),
      '2026-09-12T02:00:00Z',
    );

    await runReportingIngestJob();

    expect(writers.insertChannelDaily).toHaveBeenCalledWith([
      {
        connection_id: CONNECTION,
        metric_date: DAY,
        views: 0,
        watch_time_seconds: 0,
        engaged_views: 0,
        subscribers_gained: 0,
        subscribers_lost: 0,
      },
    ]);
    expect(writers.insertChannelReachDaily).toHaveBeenCalledWith([
      {
        connection_id: CONNECTION,
        metric_date: DAY,
        impressions: 0,
        impressions_ctr: 0,
      },
    ]);
  });

  it('writes no residual row for a header-only report', async () => {
    deliver(
      'channel_basic_a3',
      `${fixture('channel_basic_a3').split('\n')[0]}\n`,
      '2026-09-12T01:00:00Z',
    );

    await runReportingIngestJob();

    // Header-only is YouTube's "no data that day" — not a measured zero.
    const rows = writers.insertChannelDaily.mock.calls.flatMap(
      (call) => call[0] as unknown[],
    );
    expect(rows).toEqual([]);
    expect(watermarkOf('channel_basic_a3')).toBe('2026-09-12T01:00:00Z');
  });
});

describe('runReportingIngestJob — while ClickHouse is off', () => {
  // Production runs with CLICKHOUSE_ENABLED=false, where every insert
  // returns without writing. Moving the watermark past a report in that
  // state discards it for good once YouTube's retention runs out.
  it('ensures the jobs but downloads nothing and holds every watermark', async () => {
    writers.isClickHouseEnabled.mockReturnValue(false);
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');

    const result = await runReportingIngestJob();

    expect(db.jobs.map((job) => job.report_type_id).sort()).toEqual([
      'channel_basic_a3',
      'channel_combined_a3',
      'channel_reach_combined_a1',
      'channel_traffic_source_a3',
    ]);
    expect(vendor.downloads).toEqual([]);
    expect(db.watermarkWrites).toEqual([]);
    expect(result).toMatchObject({
      clickhouseEnabled: false,
      reportsIngested: 0,
      jobsEnsured: 4,
    });
  });
});

describe('runReportingIngestJob — the watermark', () => {
  it('never lands inside a run of reports that share one createTime', async () => {
    // 25 reports created in the same instant — the shape of the 30-day
    // backfill YouTube generates when a job is created. The per-run cap is
    // 20; setting the watermark to that shared instant would make a strict
    // createdAfter skip the other five for good.
    const burst = '2026-09-12T01:00:00Z';
    for (let i = 0; i < 25; i++) {
      deliver('channel_basic_a3', fixture('channel_basic_a3'), burst, `r${i}`);
    }

    await runReportingIngestJob();

    expect(vendor.downloads).toHaveLength(20);
    expect(watermarkOf('channel_basic_a3')).toBeNull();

    // The next run sees all 25 again and finishes the group.
    vendor.downloads = [];
    await runReportingIngestJob();

    expect(vendor.downloads).toHaveLength(20);
    expect(watermarkOf('channel_basic_a3')).toBeNull();
  });

  it('advances past a group once the whole group is in the batch, report by report', async () => {
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-13T01:00:00Z');

    await runReportingIngestJob();

    // Saved after each completed group, not once at the end, so a failure
    // on the third report does not re-download the first two.
    expect(db.watermarkWrites.map((write) => write.value)).toEqual([
      '2026-09-12T01:00:00Z',
      '2026-09-13T01:00:00Z',
    ]);
  });

  it('reports a failed watermark write instead of ignoring it', async () => {
    db.failWatermarkWrite = true;
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');

    const result = await runReportingIngestJob();

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      {
        connectionId: CONNECTION,
        error: expect.stringContaining('connection reset'),
      },
    ]);
  });
});

describe('runReportingIngestJob — CTR unit', () => {
  it('refuses a reach report whose CTR is a percentage, and holds its watermark', async () => {
    const percent = fixture('channel_reach_combined_a1')
      .replace(',0.05\n', ',5.0\n')
      .replace(',0.03\n', ',3.0\n')
      .replace(',0.04\n', ',4.0\n')
      .replace(',0.06\n', ',6.0\n');
    deliver('channel_reach_combined_a1', percent, '2026-09-12T02:00:00Z');

    const result = await runReportingIngestJob();

    expect(writers.insertVideoReachDaily).not.toHaveBeenCalled();
    expect(writers.insertChannelReachDaily).not.toHaveBeenCalled();
    expect(watermarkOf('channel_reach_combined_a1')).toBeNull();
    expect(result).toMatchObject({ reportsRefused: 1, success: false });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: 'channel_reach_combined_a1' }),
      expect.stringContaining('CTR'),
    );
  });
});

describe('runReportingIngestJob — accounting', () => {
  it('logs matched and unmatched counts for every report', async () => {
    deliver('channel_basic_a3', fixture('channel_basic_a3'), '2026-09-12T01:00:00Z');
    deliver(
      'channel_traffic_source_a3',
      fixture('channel_traffic_source_a3'),
      '2026-09-12T03:00:00Z',
    );

    const result = await runReportingIngestJob();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: 'channel_basic_a3',
        matched: 1,
        unmatched: 1,
        residualDates: 1,
      }),
      expect.any(String),
    );
    // Traffic rows for an unmatched video have no residual table to go to
    // (channel_daily has no source column); they are counted, not stored.
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: 'channel_traffic_source_a3',
        matched: 2,
        unmatched: 2,
      }),
      expect.any(String),
    );
    expect(result).toMatchObject({
      reportsIngested: 2,
      rowsMatched: 3,
      rowsUnmatched: 3,
    });
  });

  it('warns when a report with data rows parses to nothing', async () => {
    deliver(
      'channel_basic_a3',
      'day,video,count\n20260910,vidA,5\n',
      '2026-09-12T01:00:00Z',
    );

    await runReportingIngestJob();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: 'channel_basic_a3',
        header: 'day,video,count',
      }),
      expect.any(String),
    );
  });
});
