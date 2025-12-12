import { NextResponse } from 'next/server';

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
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

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
    const adminClient = getSupabaseServerAdminClient();

    try {
      const now = new Date();
      const { data: dueReports, error: fetchError } = await adminClient
        .from('scheduled_reports')
        .select('*')
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
  adminClient: ReturnType<typeof getSupabaseServerAdminClient>,
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

  const { data: analyticsData, error: dataError } = await adminClient
    .from('content_analytics')
    .select(
      `
      id,
      snapshot_date,
      views,
      likes,
      comments,
      shares,
      watch_time_seconds,
      subscribers_gained,
      revenue_cents,
      retention_data,
      publishes!inner (
        id,
        platform,
        title,
        episodes!inner (
          title,
          projects!inner (
            id,
            name,
            account_id
          )
        )
      )
    `,
    )
    .gte('snapshot_date', dateRange.start.toISOString().split('T')[0])
    .lte('snapshot_date', dateRange.end.toISOString().split('T')[0])
    .in('publishes.platform', report.platforms as string[])
    .eq('publishes.episodes.projects.account_id', report.account_id as string)
    .order('views', { ascending: false });

  if (dataError) {
    throw new Error(`Failed to fetch analytics: ${dataError.message}`);
  }

  if (!analyticsData || analyticsData.length === 0) {
    logger.info(ctx, 'No data found for scheduled report, skipping email');
    return;
  }

  const transformedData: AnalyticsDataRow[] = analyticsData.map((row) => ({
    snapshotDate: row.snapshot_date,
    platform: (row.publishes as { platform: string }).platform,
    contentTitle:
      (row.publishes as { title: string | null }).title ||
      (row.publishes as { episodes: { title: string } }).episodes.title,
    projectName: (row.publishes as { episodes: { projects: { name: string } } })
      .episodes.projects.name,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    watchTimeSeconds: row.watch_time_seconds,
    subscribersGained: row.subscribers_gained,
    revenueCents: row.revenue_cents,
    retentionData: row.retention_data as Record<string, number> | null,
  }));

  let buffer: Buffer;
  let filename: string;
  let contentType: string;

  const metrics = report.metrics as ReportMetric[];

  if (report.report_type === 'csv') {
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
    const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
    const nextMonday = addDays(now, daysUntilMonday);
    nextMonday.setUTCHours(8, 0, 0, 0);
    return nextMonday;
  } else {
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
