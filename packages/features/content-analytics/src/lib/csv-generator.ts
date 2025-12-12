import { formatCurrency, formatDuration, formatNumber } from './format';
import type { AnalyticsDataRow, ReportMetric } from './report-types';

/**
 * Metric to CSV column mapping
 */
const METRIC_COLUMNS: Record<
  ReportMetric,
  { header: string; getValue: (row: AnalyticsDataRow) => string }
> = {
  views: { header: 'Views', getValue: (r) => String(r.views) },
  watchTime: {
    header: 'Watch Time (seconds)',
    getValue: (r) => String(r.watchTimeSeconds),
  },
  likes: { header: 'Likes', getValue: (r) => String(r.likes) },
  comments: { header: 'Comments', getValue: (r) => String(r.comments) },
  shares: { header: 'Shares', getValue: (r) => String(r.shares) },
  subscribers: {
    header: 'Subscribers Gained',
    getValue: (r) => String(r.subscribersGained),
  },
  revenue: {
    header: 'Revenue (USD)',
    getValue: (r) => (r.revenueCents / 100).toFixed(2),
  },
  retention: {
    header: 'Retention Data',
    getValue: (r) => (r.retentionData ? JSON.stringify(r.retentionData) : ''),
  },
  ctr: { header: 'CTR', getValue: () => '' },
  avgViewDuration: { header: 'Avg View Duration', getValue: () => '' },
};

/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 */
function escapeCSVValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate CSV content from analytics data
 *
 * @param data - Analytics data rows
 * @param metrics - Metrics to include as columns
 * @returns CSV string
 */
export function generateCSV(
  data: AnalyticsDataRow[],
  metrics: ReportMetric[],
): string {
  const baseHeaders = ['Date', 'Platform', 'Project', 'Content'];
  const metricHeaders = metrics.map((m) => METRIC_COLUMNS[m].header);
  const headers = [...baseHeaders, ...metricHeaders];

  const rows = data.map((row) => {
    const baseValues = [
      row.snapshotDate,
      row.platform,
      row.projectName,
      row.contentTitle,
    ];
    const metricValues = metrics.map((m) => METRIC_COLUMNS[m].getValue(row));
    return [...baseValues, ...metricValues].map(escapeCSVValue);
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Generate summary CSV with aggregated totals and detailed data
 *
 * @param data - Analytics data rows
 * @param metrics - Metrics to include
 * @param dateRange - Date range for the report
 * @returns CSV string with summary section
 */
export function generateSummaryCSV(
  data: AnalyticsDataRow[],
  metrics: ReportMetric[],
  dateRange: { start: Date; end: Date },
): string {
  const totals = data.reduce(
    (acc, row) => ({
      views: acc.views + row.views,
      likes: acc.likes + row.likes,
      comments: acc.comments + row.comments,
      shares: acc.shares + row.shares,
      watchTimeSeconds: acc.watchTimeSeconds + row.watchTimeSeconds,
      subscribersGained: acc.subscribersGained + row.subscribersGained,
      revenueCents: acc.revenueCents + row.revenueCents,
    }),
    {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      watchTimeSeconds: 0,
      subscribersGained: 0,
      revenueCents: 0,
    },
  );

  const summary = [
    'Analytics Report Summary',
    `Date Range: ${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`,
    `Total Records: ${data.length}`,
    '',
    'Metric,Total,Formatted',
  ];

  if (metrics.includes('views')) {
    summary.push(`Views,${totals.views},${formatNumber(totals.views)}`);
  }
  if (metrics.includes('likes')) {
    summary.push(`Likes,${totals.likes},${formatNumber(totals.likes)}`);
  }
  if (metrics.includes('comments')) {
    summary.push(
      `Comments,${totals.comments},${formatNumber(totals.comments)}`,
    );
  }
  if (metrics.includes('shares')) {
    summary.push(`Shares,${totals.shares},${formatNumber(totals.shares)}`);
  }
  if (metrics.includes('watchTime')) {
    summary.push(
      `Watch Time (seconds),${totals.watchTimeSeconds},${formatDuration(totals.watchTimeSeconds)}`,
    );
  }
  if (metrics.includes('subscribers')) {
    summary.push(
      `Subscribers,${totals.subscribersGained},${formatNumber(totals.subscribersGained)}`,
    );
  }
  if (metrics.includes('revenue')) {
    summary.push(
      `Revenue (cents),${totals.revenueCents},${formatCurrency(totals.revenueCents / 100)}`,
    );
  }

  summary.push('');
  summary.push('Detailed Data');
  summary.push('');

  const detailedCSV = generateCSV(data, metrics);

  return [...summary, detailedCSV].join('\n');
}
