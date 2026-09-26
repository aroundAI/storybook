import { coverageLabel, measuredCell, measuredHeader } from './export-coverage';
import type { Coverage } from './export-coverage';
import { formatCurrency, formatDuration, formatNumber } from './format';
import { calculateReportSummary } from './report-summary';
import type { AnalyticsDataRow, ReportMetric } from './report-types';

/**
 * Metric to CSV column mapping. A column a platform may not measure has a
 * blank cell for that row, and a header that says what a blank means
 * (KB-111, KB-114).
 */
const METRIC_COLUMNS: Record<
  ReportMetric,
  { header: string; getValue: (row: AnalyticsDataRow) => string }
> = {
  views: { header: 'Views', getValue: (r) => String(r.views) },
  watchTime: {
    header: measuredHeader('Watch Time (seconds)'),
    getValue: (r) => measuredCell(r.watchTimeSeconds),
  },
  likes: { header: 'Likes', getValue: (r) => String(r.likes) },
  comments: { header: 'Comments', getValue: (r) => String(r.comments) },
  shares: { header: 'Shares', getValue: (r) => String(r.shares) },
  subscribers: {
    header: measuredHeader('Subscribers Gained'),
    getValue: (r) => measuredCell(r.subscribersGained),
  },
  revenue: {
    header: 'Revenue (USD)',
    getValue: (r) => (r.revenueCents / 100).toFixed(2),
  },
  retention: {
    header: 'Retention Data',
    getValue: (r) => (r.retentionData ? JSON.stringify(r.retentionData) : ''),
  },
  ctr: {
    header: 'CTR',
    getValue: (r) => (r.ctr > 0 ? `${(r.ctr * 100).toFixed(2)}%` : ''),
  },
  avgViewDuration: {
    header: measuredHeader('Avg View Duration (s)'),
    getValue: (r) =>
      r.avgViewDurationSeconds !== null && r.avgViewDurationSeconds > 0
        ? r.avgViewDurationSeconds.toFixed(1)
        : '',
  },
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
  const metricHeaders = metrics.map((m) =>
    escapeCSVValue(METRIC_COLUMNS[m].header),
  );
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
  const totals = calculateReportSummary(data);

  const summary = [
    'Analytics Report Summary',
    `Date Range: ${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`,
    `Total Records: ${data.length}`,
    '',
    'Metric,Total,Formatted,Coverage',
  ];

  if (metrics.includes('views')) {
    summary.push(
      `Views,${totals.totalViews},${formatNumber(totals.totalViews)},`,
    );
  }
  if (metrics.includes('likes')) {
    summary.push(
      `Likes,${totals.totalLikes},${formatNumber(totals.totalLikes)},`,
    );
  }
  if (metrics.includes('comments')) {
    summary.push(
      `Comments,${totals.totalComments},${formatNumber(totals.totalComments)},`,
    );
  }
  if (metrics.includes('shares')) {
    summary.push(
      `Shares,${totals.totalShares},${formatNumber(totals.totalShares)},`,
    );
  }
  if (metrics.includes('watchTime')) {
    summary.push(
      measuredSummaryLine(
        'Watch Time (seconds)',
        totals.totalWatchTimeSeconds,
        formatDuration,
        totals.coverage.watchTime,
      ),
    );
  }
  if (metrics.includes('subscribers')) {
    summary.push(
      measuredSummaryLine(
        'Subscribers',
        totals.totalSubscribers,
        formatNumber,
        totals.coverage.subscribers,
      ),
    );
  }
  if (metrics.includes('revenue')) {
    summary.push(
      `Revenue (cents),${totals.totalRevenueCents},${formatCurrency(totals.totalRevenueCents / 100)},`,
    );
  }

  summary.push('');
  summary.push('Detailed Data');
  summary.push('');

  const detailedCSV = generateCSV(data, metrics);

  return [...summary, detailedCSV].join('\n');
}

/**
 * A summary line for a figure some rows may not measure: blank total and
 * "not measured by the platform" when none did, else the total over the rows
 * that did and, when partial, how many (decision #33, A).
 */
function measuredSummaryLine(
  label: string,
  value: number | null,
  format: (v: number) => string,
  coverage: Coverage,
): string {
  if (value === null) {
    return `${label},,,not measured by the platform`;
  }

  return `${label},${value},${format(value)},${coverageLabel(coverage)}`;
}
