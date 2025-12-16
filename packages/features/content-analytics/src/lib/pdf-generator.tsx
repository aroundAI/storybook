import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { format } from 'date-fns';

import { formatCurrency, formatDuration, formatNumber } from './format';
import type {
  AnalyticsDataRow,
  Branding,
  DateRange,
  ReportMetric,
  ReportSummary,
} from './report-types';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 15,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    width: 60,
    height: 60,
    objectFit: 'contain',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  companyName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
  },
  dateRange: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '30%',
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    marginBottom: 10,
  },
  metricLabel: {
    fontSize: 9,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableCell: {
    flex: 1,
    fontSize: 9,
  },
  tableCellHeader: {
    flex: 1,
    fontSize: 9,
    fontWeight: 'bold',
    color: '#374151',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#9ca3af',
  },
  pageNumber: {
    fontSize: 8,
    color: '#9ca3af',
  },
});

/**
 * Metric display configuration
 */
const METRIC_DISPLAY: Record<
  ReportMetric,
  { label: string; format: (v: number) => string }
> = {
  views: { label: 'Total Views', format: formatNumber },
  watchTime: { label: 'Watch Time', format: formatDuration },
  likes: { label: 'Total Likes', format: formatNumber },
  comments: { label: 'Comments', format: formatNumber },
  shares: { label: 'Shares', format: formatNumber },
  subscribers: { label: 'Subscribers', format: formatNumber },
  revenue: { label: 'Revenue', format: (v) => formatCurrency(v / 100) },
  retention: { label: 'Avg Retention', format: (v) => `${v.toFixed(1)}%` },
  ctr: { label: 'CTR', format: (v) => `${v.toFixed(2)}%` },
  avgViewDuration: { label: 'Avg Duration', format: formatDuration },
};

/**
 * Get metric value from summary
 */
function getMetricValue(summary: ReportSummary, metric: ReportMetric): number {
  switch (metric) {
    case 'views':
      return summary.totalViews;
    case 'likes':
      return summary.totalLikes;
    case 'comments':
      return summary.totalComments;
    case 'shares':
      return summary.totalShares;
    case 'watchTime':
      return summary.totalWatchTimeSeconds;
    case 'subscribers':
      return summary.totalSubscribers;
    case 'revenue':
      return summary.totalRevenueCents;
    default:
      return 0;
  }
}

/**
 * Props for PDF report generation
 */
export interface PDFReportProps {
  data: AnalyticsDataRow[];
  summary: ReportSummary;
  dateRange: DateRange;
  metrics: ReportMetric[];
  branding?: Branding;
}

/**
 * Analytics Report PDF Document Component
 */
function AnalyticsReportDocument({
  data,
  summary,
  dateRange,
  metrics,
  branding,
}: PDFReportProps) {
  const startDate = format(dateRange.start, 'MMM d, yyyy');
  const endDate = format(dateRange.end, 'MMM d, yyyy');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              {branding?.companyName && (
                <Text style={styles.companyName}>{branding.companyName}</Text>
              )}
              <Text style={styles.title}>Analytics Report</Text>
              <Text style={styles.dateRange}>
                {startDate} - {endDate}
              </Text>
            </View>
            {branding?.logoUrl && (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image doesn't support alt
              <Image style={styles.logo} src={branding.logoUrl} />
            )}
          </View>
        </View>

        {/* Summary Metrics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.metricsGrid}>
            {metrics.slice(0, 6).map((metric) => {
              const config = METRIC_DISPLAY[metric];
              const value = getMetricValue(summary, metric);
              return (
                <View key={metric} style={styles.metricCard}>
                  <Text style={styles.metricLabel}>{config.label}</Text>
                  <Text style={styles.metricValue}>{config.format(value)}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Platform Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Platform Breakdown</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableCellHeader}>Platform</Text>
              <Text style={styles.tableCellHeader}>Views</Text>
            </View>
            {Object.entries(summary.platformBreakdown).map(
              ([platform, views]) => (
                <View key={platform} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{platform}</Text>
                  <Text style={styles.tableCell}>{formatNumber(views)}</Text>
                </View>
              ),
            )}
          </View>
        </View>

        {/* Top Content */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Content</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableCellHeader}>Content</Text>
              <Text style={styles.tableCellHeader}>Platform</Text>
              <Text style={styles.tableCellHeader}>Views</Text>
              <Text style={styles.tableCellHeader}>Engagement</Text>
            </View>
            {data.slice(0, 10).map((row, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.tableCell}>
                  {row.contentTitle.slice(0, 30)}
                  {row.contentTitle.length > 30 ? '...' : ''}
                </Text>
                <Text style={styles.tableCell}>{row.platform}</Text>
                <Text style={styles.tableCell}>{formatNumber(row.views)}</Text>
                <Text style={styles.tableCell}>
                  {formatNumber(row.likes + row.comments + row.shares)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated on {format(new Date(), "MMM d, yyyy 'at' h:mm a")}
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

/**
 * Generate PDF report buffer
 *
 * @param props - Report configuration and data
 * @returns PDF as Buffer
 */
export async function generatePDFReport(
  props: PDFReportProps,
): Promise<Buffer> {
  const buffer = await renderToBuffer(<AnalyticsReportDocument {...props} />);
  return Buffer.from(buffer);
}
