import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getClickHouseClient,
  queryChannelWatchWindow,
  querySubscriberDeltas,
} from '@kit/clickhouse/server';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/**
 * The report ingest against the real local stack (FILM-1504 §26, T3).
 *
 * Real Postgres (a seeded YouTube connection and a publish for `vidA`), real
 * ClickHouse, and the figures read back through the functions the YPP card
 * and the subscriber curve call. Only the vendor is replaced: a fake that
 * serves the fixture CSVs for this test's connection and offers no report
 * types to any other, so other connections in the database are untouched.
 * The token lookup is stubbed so no refresh is attempted (KB-29).
 *
 * Off unless asked for. Needs `./scripts/local-env.sh up` and the seeded
 * "The Chronicles" project (`supabase/seeds/analytics-mock-data.sql`):
 *
 *   set -a; . deployment/config/local.env; set +a
 *   REPORT_INGEST_LOCAL_STACK=1 pnpm --filter @kit/content-analytics test report-ingest.local-stack
 *
 * Hand-computed answers, from the fixtures (see csv-parsers.test.ts):
 *   residual (vidX)  : 400 views, 1,800 s watch, subscribers +3/−1 → net +2
 *   residual reach   : 4,000 impressions, CTR (40 + 180) / 4,000 = 0.055
 *   matched (vidA)   : 150 views, 900 s; 4,000 impressions at CTR 0.04
 */
const FIXTURE_PROJECT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const REPORT_TYPES = [
  'channel_basic_a3',
  'channel_combined_a3',
  'channel_traffic_source_a3',
  'channel_reach_combined_a1',
];

/** Three days ago, inside every window the readers use. */
const DAY = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const DAY_COMPACT = DAY.replaceAll('-', '');

const state = vi.hoisted(() => ({
  connectionId: '',
  reports: new Map<
    string,
    Array<{ reportId: string; createTime: string; downloadUrl: string }>
  >(),
  files: new Map<string, string>(),
}));

vi.mock('@kit/publishing/token-refresh', () => ({
  // The connection id doubles as the token, so the provider below knows
  // whose reports it is serving.
  ensureValidToken: async (connectionId: string) => ({
    valid: true,
    accessToken: connectionId,
  }),
}));

vi.mock('../src/providers/youtube/youtube-reporting', () => ({
  YOUTUBE_REPORT_TYPES: [
    'channel_basic_a3',
    'channel_combined_a3',
    'channel_traffic_source_a3',
    'channel_reach_combined_a1',
  ],
  createYouTubeReportingProvider: (token: string) => {
    const ours = token === state.connectionId;

    return {
      listReportTypes: async () =>
        ours
          ? [
              'channel_basic_a3',
              'channel_combined_a3',
              'channel_traffic_source_a3',
              'channel_reach_combined_a1',
            ]
          : [],
      listJobs: async () => [],
      createJob: async (reportTypeId: string) => ({
        jobId: `local-${reportTypeId}`,
        reportTypeId,
      }),
      listReports: async (jobId: string, createdAfter?: string) =>
        (ours ? (state.reports.get(jobId) ?? []) : [])
          // Instants, not strings: the watermark comes back from Postgres
          // as `…+00:00`, the fixtures say `…Z`.
          .filter(
            (r) =>
              !createdAfter ||
              Date.parse(r.createTime) > Date.parse(createdAfter),
          )
          .map((r) => ({ ...r, startTime: '', endTime: '' })),
      downloadReport: async (url: string) => state.files.get(url) ?? '',
    };
  },
}));

const { runReportingIngestJob } = await import(
  '../src/server/reporting/report-ingest'
);

const FIXTURES = join(import.meta.dirname, 'fixtures', 'youtube-reporting');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.csv`), 'utf8').replaceAll(
    '20260910',
    DAY_COMPACT,
  );
}

let clock = Date.parse('2026-01-01T00:00:00Z');

/** Queue one report; each gets a later createTime than the last. */
function deliver(reportType: string, csv: string) {
  clock += 60_000;
  const createTime = new Date(clock).toISOString();
  const reportId = `${reportType}-${clock}`;
  const url = `https://fake.invalid/v1/media/${reportId}`;
  const jobId = `local-${reportType}`;

  state.files.set(url, csv);
  state.reports.set(jobId, [
    ...(state.reports.get(jobId) ?? []),
    { reportId, createTime, downloadUrl: url },
  ]);
}

async function readBack() {
  const connectionIds = [state.connectionId];
  const [watch, deltas] = await Promise.all([
    queryChannelWatchWindow({ connectionIds, windowDays: 30 }),
    querySubscriberDeltas({ connectionIds, from: DAY, to: DAY }),
  ]);

  const select = async <T>(query: string) => {
    const result = await getClickHouseClient().query({
      query,
      query_params: { connection: state.connectionId, day: DAY },
      format: 'JSONEachRow',
    });
    return result.json<T>();
  };

  const [residual] = await select<{ views: string; watch: string }>(`
    SELECT toString(views) AS views, toString(watch_time_seconds) AS watch
    FROM channel_daily FINAL
    WHERE connection_id = {connection:UUID} AND metric_date = {day:Date}`);
  const [reach] = await select<{ impressions: string; ctr: number }>(`
    SELECT toString(impressions) AS impressions, round(impressions_ctr, 4) AS ctr
    FROM channel_reach_daily FINAL
    WHERE connection_id = {connection:UUID} AND metric_date = {day:Date}`);

  return {
    ypp_watch_seconds: watch.watchTimeSeconds,
    residual_net_subscribers: deltas.map((d) => d.net).join(','),
    residual_views: residual?.views ?? 'none',
    residual_watch: residual?.watch ?? 'none',
    residual_impressions: reach?.impressions ?? 'none',
    residual_ctr: reach?.ctr ?? 'none',
  };
}

const EXPECTED = {
  // Matched vidA (900 s) is in video_metrics, not this leg; the channel
  // watch window is the residual only. `querySubscriberDeltas` sums both
  // legs, but vidA has no video_dim row here, so the residual is all it
  // sees: +3 −1.
  ypp_watch_seconds: 1800,
  residual_net_subscribers: '2',
  residual_views: '400',
  residual_watch: '1800',
  residual_impressions: '4000',
  residual_ctr: 0.055,
};

describe.skipIf(!process.env.REPORT_INGEST_LOCAL_STACK)(
  'runReportingIngestJob against local Postgres and ClickHouse',
  () => {
    // A function, not a value: the describe body runs at collection even
    // when skipped, and the client validates its environment eagerly.
    const admin = () => getSupabaseServerAdminClient();

    beforeAll(async () => {
      const { data: project, error: projectError } = await admin()
        .from('projects')
        .select('account_id')
        .eq('id', FIXTURE_PROJECT)
        .single();
      if (projectError) throw projectError;

      const { data: connection, error: connectionError } = await admin()
        .from('platform_connections')
        .insert({
          account_id: project.account_id,
          platform: 'youtube',
          platform_account_id: `film-1504-${Date.now()}`,
          platform_account_name: 'FILM-1504 local stack',
          is_active: true,
        })
        .select('id')
        .single();
      if (connectionError) throw connectionError;
      state.connectionId = connection.id;

      const { data: episode, error: episodeError } = await admin()
        .from('episodes')
        .insert({
          project_id: FIXTURE_PROJECT,
          number: 9000 + (Date.now() % 1000),
          title: 'FILM-1504 local stack',
        })
        .select('id')
        .single();
      if (episodeError) throw episodeError;

      const { error: publishError } = await admin().from('publishes').insert({
        episode_id: episode.id,
        platform: 'youtube',
        platform_connection_id: connection.id,
        platform_content_id: 'vidA',
        status: 'published',
        title: 'FILM-1504 vidA',
        published_at: new Date().toISOString(),
      });
      if (publishError) throw publishError;
    });

    afterAll(async () => {
      if (!state.connectionId) return;
      // Cascades to the publish and the job registry rows.
      await admin()
        .from('platform_connections')
        .delete()
        .eq('id', state.connectionId);
    });

    it('registers one job per report type, once', async () => {
      await runReportingIngestJob();
      await runReportingIngestJob();

      const { data } = await admin()
        .from('youtube_report_jobs')
        .select('report_type_id')
        .eq('platform_connection_id', state.connectionId);

      expect((data ?? []).map((row) => row.report_type_id).sort()).toEqual(
        [...REPORT_TYPES].sort(),
      );
    });

    // Within one run the ingest walks jobs in registry order, so the order
    // two reports land in is set by which run collects each — as it is in
    // production, where they are generated hours apart.
    it('keeps the core residual when the reach report lands second', async () => {
      deliver('channel_basic_a3', fixture('channel_basic_a3'));
      const first = await runReportingIngestJob();

      deliver(
        'channel_reach_combined_a1',
        fixture('channel_reach_combined_a1'),
      );
      const second = await runReportingIngestJob();

      const got = await readBack();

      // eslint-disable-next-line no-console
      console.table({ 'basic → reach': got, expected: EXPECTED });

      expect([...first.errors, ...second.errors]).toEqual([]);
      expect(got).toEqual(EXPECTED);
    });

    it('keeps the reach residual when the core report lands second', async () => {
      deliver(
        'channel_reach_combined_a1',
        fixture('channel_reach_combined_a1'),
      );
      await runReportingIngestJob();

      deliver('channel_basic_a3', fixture('channel_basic_a3'));
      await runReportingIngestJob();

      const got = await readBack();

      // eslint-disable-next-line no-console
      console.table({ 'reach → basic': got, expected: EXPECTED });

      expect(got).toEqual(EXPECTED);
    });

    it('changes nothing when the same reports are delivered again', async () => {
      deliver('channel_basic_a3', fixture('channel_basic_a3'));
      deliver(
        'channel_reach_combined_a1',
        fixture('channel_reach_combined_a1'),
      );
      deliver(
        'channel_traffic_source_a3',
        fixture('channel_traffic_source_a3'),
      );

      await runReportingIngestJob();
      const got = await readBack();

      expect(got).toEqual(EXPECTED);
    });

    it('lands matched rows once per video/day, whatever the number of deliveries', async () => {
      const { data: publish } = await admin()
        .from('publishes')
        .select('id')
        .eq('platform_connection_id', state.connectionId)
        .single();

      const rows = async (table: string, extra = '') => {
        const res = await getClickHouseClient().query({
          query: `
            SELECT ${extra || 'toString(count()) AS n'}
            FROM ${table} FINAL
            WHERE video_id = {video:String} AND metric_date = {day:Date}`,
          query_params: { video: publish!.id, day: DAY },
          format: 'JSONEachRow',
        });
        return res.json<Record<string, string | number>>();
      };

      const metrics = await rows(
        'video_metrics',
        'toString(views) AS views, toString(watch_time_seconds) AS watch, toString(engaged_views) AS engaged, metric_source',
      );
      const reach = await rows(
        'video_reach_daily',
        'toString(impressions) AS impressions, round(impressions_ctr, 4) AS ctr',
      );
      const traffic = await rows(
        'video_traffic_sources',
        'source, toString(views) AS views',
      );

      // eslint-disable-next-line no-console
      console.table({ metrics, reach, traffic });

      expect(metrics).toEqual([
        {
          views: '150',
          watch: '900',
          engaged: '135', // KB-50: parsed, and now stored
          metric_source: 'reporting_api',
        },
      ]);
      expect(reach).toEqual([{ impressions: '4000', ctr: 0.04 }]);
      expect(traffic.map((row) => `${row.source}:${row.views}`).sort()).toEqual(
        ['RELATED_VIDEO:75', 'SUBSCRIBER:75'],
      );
    });

    // A redelivered day on which vidX now matches a publish must take vidX
    // out of the residual. Otherwise it is counted twice: per video, and in
    // channel_daily.
    it('empties the residual when a redelivered day has every video matched', async () => {
      const { data: episode } = await admin()
        .from('episodes')
        .insert({
          project_id: FIXTURE_PROJECT,
          number: 9500 + (Date.now() % 400),
          title: 'FILM-1504 vidX',
        })
        .select('id')
        .single();
      await admin().from('publishes').insert({
        episode_id: episode!.id,
        platform: 'youtube',
        platform_connection_id: state.connectionId,
        platform_content_id: 'vidX',
        status: 'published',
        title: 'FILM-1504 vidX',
        published_at: new Date().toISOString(),
      });

      deliver('channel_basic_a3', fixture('channel_basic_a3'));
      deliver(
        'channel_reach_combined_a1',
        fixture('channel_reach_combined_a1'),
      );

      await runReportingIngestJob();
      const got = await readBack();

      // eslint-disable-next-line no-console
      console.table({ 'vidX matched': got });

      expect(got).toMatchObject({
        ypp_watch_seconds: 0,
        residual_views: '0',
        residual_impressions: '0',
      });
    });
  },
);
