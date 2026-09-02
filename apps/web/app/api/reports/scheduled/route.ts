import { NextResponse } from 'next/server';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
  subWeeks,
} from 'date-fns';

import { generateSummaryCSV } from '@kit/content-analytics/lib/csv-generator';
import { generatePDFReport } from '@kit/content-analytics/lib/pdf-generator';
import type {
  AnalyticsDataRow,
  ReportMetric,
  ReportSummary,
} from '@kit/content-analytics/lib/report-types';
import { getMailer } from '@kit/mailers';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { chunkIds, fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/** Retention curves fetched in parallel per batch. */
const RETENTION_CONCURRENCY = 20;

/**
 * Ceiling on how many videos a report fetches retention curves for.
 *
 * Each curve is its own ClickHouse round trip. Bounding the concurrency
 * caps how many run at once but not how many run in total, so a report over
 * tens of thousands of videos would still serialize thousands of waves
 * inside one Lambda invocation. Retention is an optional enrichment column,
 * so it degrades: the cap is logged rather than silently applied.
 */
const MAX_RETENTION_VIDEOS = 500;

/**
 * Cron endpoint for processing scheduled reports.
 *
 * Should be called hourly by cron scheduler.
 * Protected by CRON_SECRET bearer token.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.scheduled-reports' };

    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.error(ctx, 'CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 },
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn(ctx, 'Unauthorized cron request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = getSupabaseServerAdminClient() as SupabaseClient<any>;

    try {
      const now = new Date();
      const { data: dueReports, error: fetchError } = await adminClient
        .from('scheduled_reports')
        .select(
          `
          id, account_id, name, report_type, frequency, metrics, platforms,
          project_ids, branding, recipients, next_run_at, last_run_at,
          last_run_status, last_error, is_active, created_at, updated_at
        `,
        )
        .eq('is_active', true)
        .lte('next_run_at', now.toISOString());

      if (fetchError) {
        throw new Error(`Failed to fetch due reports: ${fetchError.message}`);
      }

      logger.info(
        { ...ctx, count: dueReports?.length || 0 },
        'Found due reports',
      );

      const results = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const report of dueReports || []) {
        results.processed++;

        try {
          await processScheduledReport(report, adminClient, logger);
          results.succeeded++;

          const nextRunAt = calculateNextRunTime(report.frequency);
          await adminClient
            .from('scheduled_reports')
            .update({
              last_run_at: now.toISOString(),
              last_run_status: 'success',
              last_error: null,
              next_run_at: nextRunAt.toISOString(),
            })
            .eq('id', report.id);
        } catch (error) {
          results.failed++;
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error';
          results.errors.push(`${report.id}: ${errorMsg}`);

          logger.error(
            { ...ctx, reportId: report.id, error: errorMsg },
            'Failed to process scheduled report',
          );

          await adminClient
            .from('scheduled_reports')
            .update({
              last_run_at: now.toISOString(),
              last_run_status: 'failed',
              last_error: errorMsg,
            })
            .eq('id', report.id);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        { ...ctx, ...results, durationMs: duration },
        'Scheduled reports job completed',
      );

      return NextResponse.json({
        success: true,
        ...results,
        durationMs: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      logger.error(
        { ...ctx, error: errorMsg, durationMs: duration },
        'Scheduled reports job failed',
      );

      return NextResponse.json(
        { success: false, error: 'Internal error', durationMs: duration },
        { status: 500 },
      );
    }
  },
  { auth: false },
);

async function processScheduledReport(
  report: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient<any>,
  logger: Awaited<ReturnType<typeof getLogger>>,
) {
  const ctx = { name: 'process-scheduled-report', reportId: report.id };

  const dateRange =
    report.frequency === 'weekly'
      ? { start: subWeeks(new Date(), 1), end: new Date() }
      : {
          start: startOfMonth(subMonths(new Date(), 1)),
          end: endOfMonth(subMonths(new Date(), 1)),
        };

  // 1. Fetch publish metadata from Supabase. Paged: this is the content set
  // of an emailed report, so truncation silently ships an incomplete report
  // that nobody reading it can tell is incomplete.
  const publishes = await fetchAllRows<{
    id: string;
    platform: string;
    title: string | null;
    content_type: string | null;
    language: string | null;
    published_at: string | null;
    episodes: unknown;
  }>(
    (from, to) =>
      adminClient
        .from('publishes')
        .select(
          `
      id,
      platform,
      title,
      content_type,
      language,
      published_at,
      episodes!inner (
        title,
        projects!inner (
          id,
          name,
          account_id
        )
      )
    `,
        )
        .in('platform', report.platforms as string[])
        .eq('episodes.projects.account_id', report.account_id as string)
        .order('id')
        .range(from, to),
    'scheduled report publishes',
  );

  if (publishes.length === 0) {
    logger.info(ctx, 'No data found for scheduled report, skipping email');
    return;
  }

  // 2. Query analytics from ClickHouse
  const {
    queryQualityMetricsForVideos,
    queryRetentionCurve,
    queryTotalsByVideoIds,
    queryTrafficSources,
  } = await import('@kit/clickhouse/server');
  const { formatDateStr } = await import('@kit/clickhouse');
  const videoIds = publishes.map((p) => p.id);
  const includeRetention = ((report.metrics ?? []) as string[]).includes(
    'retention',
  );

  const [analyticsMap, qualityMap] = await Promise.all([
    queryTotalsByVideoIds(videoIds, {
      startDate: formatDateStr(dateRange.start),
      endDate: formatDateStr(dateRange.end),
    }),
    queryQualityMetricsForVideos({
      videoIds,
      startDate: formatDateStr(dateRange.start),
      endDate: formatDateStr(dateRange.end),
    }),
  ]);

  // Retention curves are lifetime aggregates fetched per video, so only
  // pull them when the report includes the retention column
  const retentionMap = new Map<string, Record<string, number>>();

  if (includeRetention) {
    // One ClickHouse round trip per video, so the fan-out is bounded. The
    // publish list is paged now and no longer implicitly capped at 1,000 by
    // the server, and `analyticsMap.has(id)` narrows this set without
    // bounding it — an account with tens of thousands of publishes would
    // otherwise open that many simultaneous connections from one Lambda.
    // A batched `queryRetentionCurves(videoIds)` would be better still.
    const eligible = videoIds.filter((id) => analyticsMap.has(id));
    const withMetrics = eligible.slice(0, MAX_RETENTION_VIDEOS);

    if (eligible.length > withMetrics.length) {
      logger.warn(
        {
          ...ctx,
          eligible: eligible.length,
          fetched: withMetrics.length,
        },
        'Retention curves capped; report will omit them for the remainder',
      );
    }

    for (const batch of chunkIds(withMetrics, RETENTION_CONCURRENCY)) {
      await Promise.all(
        batch.map(async (videoId) => {
          const points = await queryRetentionCurve({ videoId });

          if (points.length > 0) {
            retentionMap.set(
              videoId,
              Object.fromEntries(
                points.map((p) => [
                  p.elapsedRatio.toFixed(2),
                  p.audienceWatchRatio,
                ]),
              ),
            );
          }
        }),
      );
    }
  }

  // 3. Merge publish metadata with ClickHouse analytics
  const transformedData: AnalyticsDataRow[] = publishes
    .map((pub): AnalyticsDataRow | null => {
      const totals = analyticsMap.get(pub.id);
      if (!totals) return null;

      const quality = qualityMap.get(pub.id);

      const episodes = pub.episodes as unknown as {
        title: string;
        projects: { name: string };
      };

      return {
        snapshotDate: formatDateStr(dateRange.end), // Report-level date
        platform: pub.platform,
        contentTitle: pub.title || episodes.title,
        projectName: episodes.projects.name,
        views: totals.views,
        likes: totals.likes,
        comments: totals.comments,
        shares: totals.shares,
        watchTimeSeconds: totals.watch_time_seconds,
        subscribersGained: totals.subscribers_gained,
        revenueCents: totals.revenue_cents,
        retentionData: retentionMap.get(pub.id) ?? null,
        impressions: quality?.impressions ?? 0,
        ctr: quality?.impressionsCtr ?? 0,
        avgViewDurationSeconds: quality?.avgViewDurationSeconds ?? 0,
      };
    })
    .filter((row): row is AnalyticsDataRow => row !== null);

  if (transformedData.length === 0) {
    logger.info(
      ctx,
      'No analytics data found for scheduled report, skipping email',
    );
    return;
  }

  let buffer: Buffer;
  let filename: string;
  let contentType: string;

  const metrics = report.metrics as ReportMetric[];

  if (report.report_type === 'raw_csv') {
    // Full per-video per-day dump, so a multi-year series survives
    // outside any dashboard's retention window
    const { generateRawExportCSV, videoAgeInDays } = await import(
      '@kit/content-analytics/lib/raw-export-generator'
    );
    const { queryDailyStats } = await import('@kit/clickhouse/server');

    const dailyRows = await queryDailyStats({
      videoIds,
      startDate: formatDateStr(dateRange.start),
      endDate: formatDateStr(dateRange.end),
    });

    const metaByPublish = new Map(
      publishes.map((pub) => [
        pub.id,
        {
          title:
            pub.title ||
            (pub.episodes as unknown as { title: string }).title ||
            '',
          publishedAt: pub.published_at ?? '',
          contentType: pub.content_type ?? '',
          language: pub.language ?? '',
        },
      ]),
    );

    // Highest-view traffic source per video per day
    const trafficRows = await queryTrafficSources({
      videoIds,
      startDate: formatDateStr(dateRange.start),
      endDate: formatDateStr(dateRange.end),
      byDate: true,
      byVideo: true,
    });

    const topSourceByVideoDate = new Map<string, string>();
    const topViewsByVideoDate = new Map<string, number>();

    for (const t of trafficRows) {
      if (!t.date || !t.videoId) continue;
      const key = `${t.videoId}:${t.date}`;
      const current = topViewsByVideoDate.get(key) ?? -1;
      if (t.views > current) {
        topViewsByVideoDate.set(key, t.views);
        topSourceByVideoDate.set(key, t.source);
      }
    }

    // Taxonomy tags as 'dimension:slug', matching video_dim.tags.
    // Chunked and paged: publish_tags holds one row per assignment, so it
    // truncates well before the publish count does and the export would
    // ship blank tag columns for videos that are in fact tagged.
    const tagRows = await fetchAllByIds<{
      publish_id: string;
      content_tags: unknown;
    }>(
      videoIds,
      (chunk, from, to) =>
        adminClient
          .from('publish_tags')
          .select('publish_id, content_tags!inner(dimension, slug)')
          .in('publish_id', chunk)
          .order('publish_id')
          .order('tag_id')
          .range(from, to),
      'scheduled report tags',
    );

    const tagsByPublish = new Map<string, string[]>();

    for (const tagRow of tagRows) {
      const tag = tagRow.content_tags as unknown as {
        dimension: string;
        slug: string;
      } | null;
      if (!tag) continue;
      const key = tagRow.publish_id as string;
      tagsByPublish.set(key, [
        ...(tagsByPublish.get(key) ?? []),
        `${tag.dimension}:${tag.slug}`,
      ]);
    }

    // Views-at-age are per-video lifetime figures, so they cannot be
    // derived from `dailyRows` — those cover only the report window, and a
    // video published a year ago has none of its first 30 days in it.
    const { queryVideoViewsAtAge } = await import('@kit/clickhouse/server');
    const { listAccountChannels } = await import(
      '@kit/content-analytics/server'
    );

    const [ageRows, channels] = await Promise.all([
      queryVideoViewsAtAge({
        scope: { accountId: report.account_id as string },
        videoIds,
        checkpoints: [30, 90, 180, 365],
      }),
      listAccountChannels(report.account_id as string),
    ]);

    const ageByVideo = new Map(ageRows.map((row) => [row.videoId, row]));
    const channelNameById = new Map(
      channels.map((channel) => [channel.connectionId, channel.name]),
    );

    /** Blank unless the checkpoint has actually elapsed for this video. */
    const checkpoint = (videoId: string, days: number): number | null => {
      const age = ageByVideo.get(videoId);
      if (!age || !age.matureAt[days]) return null;
      return age.viewsAtAge[days] ?? null;
    };

    const rawRows = dailyRows.map((row) => {
      const meta = metaByPublish.get(row.video_id);
      const quality = qualityMap.get(row.video_id);

      return {
        date: row.metric_date,
        videoId: row.video_id,
        title: meta?.title ?? '',
        platform: row.platform,
        contentType: meta?.contentType ?? '',
        language: meta?.language ?? '',
        publishedAt: meta?.publishedAt ?? '',
        videoAgeDays: meta?.publishedAt
          ? videoAgeInDays(meta.publishedAt, row.metric_date)
          : 0,
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        saves: row.saves,
        watchTimeSeconds: row.watch_time_seconds,
        subscribersGained: row.subscribers_gained,
        revenueCents: row.revenue_cents,
        // Reach is a period total rather than a per-day figure, so it is
        // reported once per video on its own row set; CTR and AVD are the
        // view-weighted period rates.
        impressions: quality?.impressions ?? 0,
        ctr: quality?.impressionsCtr ?? 0,
        avgViewDurationSeconds: quality?.avgViewDurationSeconds ?? 0,
        topTrafficSource:
          topSourceByVideoDate.get(`${row.video_id}:${row.metric_date}`) ?? '',
        tags: tagsByPublish.get(row.video_id)?.join('|') ?? '',
        channelName:
          channelNameById.get(
            ageByVideo.get(row.video_id)?.connectionId ?? '',
          ) ?? '',
        viewsAt30: checkpoint(row.video_id, 30),
        viewsAt90: checkpoint(row.video_id, 90),
        viewsAt180: checkpoint(row.video_id, 180),
        viewsAt365: checkpoint(row.video_id, 365),
      };
    });

    buffer = Buffer.from(generateRawExportCSV(rawRows), 'utf-8');
    filename = `analytics-raw-${dateRange.start.toISOString().split('T')[0]}.csv`;
    contentType = 'text/csv';
  } else if (report.report_type === 'csv') {
    const csvContent = generateSummaryCSV(transformedData, metrics, dateRange);
    buffer = Buffer.from(csvContent, 'utf-8');
    filename = `analytics-report-${dateRange.start.toISOString().split('T')[0]}.csv`;
    contentType = 'text/csv';
  } else {
    const summary = calculateSummary(transformedData);
    buffer = await generatePDFReport({
      data: transformedData,
      summary,
      dateRange,
      metrics,
      branding: report.branding as
        | { logoUrl?: string; primaryColor?: string; companyName?: string }
        | undefined,
    });
    filename = `analytics-report-${dateRange.start.toISOString().split('T')[0]}.pdf`;
    contentType = 'application/pdf';
  }

  const path = `scheduled/${report.id}/${Date.now()}-${filename}`;

  const { error: uploadError } = await adminClient.storage
    .from('reports')
    .upload(path, buffer, { contentType, cacheControl: '86400' });

  if (uploadError) {
    throw new Error(`Failed to upload report: ${uploadError.message}`);
  }

  const { data: signedUrlData, error: signedUrlError } =
    await adminClient.storage.from('reports').createSignedUrl(path, 604800);

  if (signedUrlError || !signedUrlData) {
    throw new Error(`Failed to create signed URL: ${signedUrlError?.message}`);
  }

  const mailer = await getMailer();
  const recipients = report.recipients as string[];
  const reportName = report.name as string;
  const frequency = report.frequency === 'weekly' ? 'Weekly' : 'Monthly';
  const emailSender = process.env.EMAIL_SENDER || 'noreply@example.com';

  for (const recipient of recipients) {
    await mailer.sendEmail({
      to: recipient,
      from: emailSender,
      subject: `Your ${frequency} Analytics Report: ${reportName}`,
      html: generateReportEmailHtml({
        reportName,
        frequency,
        dateRange,
        downloadUrl: signedUrlData.signedUrl,
        recordCount: transformedData.length,
      }),
    });
  }

  logger.info(
    {
      ...ctx,
      recipientCount: recipients.length,
      recordCount: transformedData.length,
    },
    'Scheduled report processed and emailed',
  );
}

function generateReportEmailHtml(params: {
  reportName: string;
  frequency: string;
  dateRange: { start: Date; end: Date };
  downloadUrl: string;
  recordCount: number;
}): string {
  const { reportName, frequency, dateRange, downloadUrl, recordCount } = params;
  const startDate = format(dateRange.start, 'MMM d, yyyy');
  const endDate = format(dateRange.end, 'MMM d, yyyy');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 20px; }
        .title { font-size: 24px; font-weight: bold; color: #111; margin: 0; }
        .subtitle { color: #666; margin-top: 5px; }
        .content { margin: 20px 0; }
        .stat { display: inline-block; margin-right: 30px; margin-bottom: 10px; }
        .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .stat-value { font-size: 18px; font-weight: bold; color: #111; }
        .button { display: inline-block; background: #3b82f6; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="title">${frequency} Analytics Report</h1>
          <p class="subtitle">${reportName}</p>
        </div>
        <div class="content">
          <p>Your scheduled analytics report is ready for download.</p>
          <div style="margin: 20px 0;">
            <div class="stat">
              <div class="stat-label">Date Range</div>
              <div class="stat-value">${startDate} - ${endDate}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Records</div>
              <div class="stat-value">${recordCount}</div>
            </div>
          </div>
          <a href="${downloadUrl}" class="button">Download Report</a>
          <p style="font-size: 12px; color: #666;">This download link expires in 7 days.</p>
        </div>
        <div class="footer">
          <p>You're receiving this email because you have a scheduled report configured.</p>
          <p>To manage your scheduled reports, visit your analytics dashboard.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function calculateNextRunTime(frequency: string): Date {
  const now = new Date();

  if (frequency === 'weekly') {
    const currentDay = now.getUTCDay();
    const currentHour = now.getUTCHours();

    // If it's Monday before 8:00 UTC, schedule for today
    if (currentDay === 1 && currentHour < 8) {
      const today = new Date(now);
      today.setUTCHours(8, 0, 0, 0);
      return today;
    }

    // Otherwise, schedule for next Monday
    const daysUntilMonday = (8 - currentDay) % 7 || 7;
    const nextMonday = addDays(now, daysUntilMonday);
    nextMonday.setUTCHours(8, 0, 0, 0);
    return nextMonday;
  } else {
    const currentDay = now.getUTCDate();
    const currentHour = now.getUTCHours();

    // If it's the 1st before 8:00 UTC, schedule for today
    if (currentDay === 1 && currentHour < 8) {
      const today = new Date(now);
      today.setUTCHours(8, 0, 0, 0);
      return today;
    }

    // Otherwise, schedule for next month's 1st
    const nextMonth = addMonths(startOfMonth(now), 1);
    nextMonth.setUTCHours(8, 0, 0, 0);
    return nextMonth;
  }
}

function calculateSummary(data: AnalyticsDataRow[]): ReportSummary {
  const platformBreakdown: Record<string, number> = {};

  const totals = data.reduce(
    (acc, row) => {
      platformBreakdown[row.platform] =
        (platformBreakdown[row.platform] || 0) + row.views;

      return {
        totalViews: acc.totalViews + row.views,
        totalLikes: acc.totalLikes + row.likes,
        totalComments: acc.totalComments + row.comments,
        totalShares: acc.totalShares + row.shares,
        totalWatchTimeSeconds: acc.totalWatchTimeSeconds + row.watchTimeSeconds,
        totalSubscribers: acc.totalSubscribers + row.subscribersGained,
        totalRevenueCents: acc.totalRevenueCents + row.revenueCents,
      };
    },
    {
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalWatchTimeSeconds: 0,
      totalSubscribers: 0,
      totalRevenueCents: 0,
    },
  );

  return {
    ...totals,
    contentCount: new Set(data.map((d) => d.contentTitle)).size,
    platformBreakdown,
  };
}
