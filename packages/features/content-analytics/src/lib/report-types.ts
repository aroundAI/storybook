import type { z } from 'zod';

import type {
  BrandingSchema,
  DatePresetSchema,
  DateRangeSchema,
  ReportMetricSchema,
  ReportPlatformSchema,
} from './schemas/report.schema';

/**
 * Report metric type - inferred from schema
 */
export type ReportMetric = z.infer<typeof ReportMetricSchema>;

/**
 * Report platform type - inferred from schema
 */
export type ReportPlatform = z.infer<typeof ReportPlatformSchema>;

/**
 * Date preset type - inferred from schema
 */
export type DatePreset = z.infer<typeof DatePresetSchema>;

/**
 * Date range type - inferred from schema
 */
export type DateRange = z.infer<typeof DateRangeSchema>;

/**
 * Branding options type - inferred from schema
 */
export type Branding = z.infer<typeof BrandingSchema>;

/**
 * Report configuration for generating a report
 */
export interface ReportConfig {
  type: 'pdf' | 'csv';
  dateRange: DateRange;
  metrics: ReportMetric[];
  platforms: ReportPlatform[];
  projectIds?: string[];
  branding?: Branding;
}

/**
 * Result of generating a report
 */
export interface GeneratedReport {
  downloadUrl: string;
  expiresAt: Date;
  type: 'pdf' | 'csv';
  dateRange: DateRange;
  recordCount: number;
}

/**
 * Scheduled report configuration from database
 */
export interface ScheduledReport {
  id: string;
  accountId: string;
  name: string;
  reportType: 'pdf' | 'csv';
  frequency: 'weekly' | 'monthly';
  metrics: ReportMetric[];
  platforms: ReportPlatform[];
  projectIds: string[] | null;
  branding: Branding | null;
  recipients: string[];
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastError: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Analytics data row for reports
 */
export interface AnalyticsDataRow {
  snapshotDate: string;
  platform: string;
  contentTitle: string;
  projectName: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
  retentionData: Record<string, number> | null;
}

/**
 * Aggregated summary for PDF report header
 */
export interface ReportSummary {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalWatchTimeSeconds: number;
  totalSubscribers: number;
  totalRevenueCents: number;
  contentCount: number;
  platformBreakdown: Record<string, number>;
}

/**
 * Metric display configuration for UI
 */
export interface MetricDisplayConfig {
  id: ReportMetric;
  label: string;
  category: 'Engagement' | 'Growth' | 'Monetization' | 'Performance';
  dbField: string;
  formatter: (value: number) => string;
}

/**
 * Date preset configuration for UI
 */
export interface DatePresetConfig {
  id: DatePreset;
  label: string;
  getRange: () => { start: Date; end: Date } | null;
}
