import type { z } from 'zod';

import type { Coverage } from './export-coverage';
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
  reportType: 'pdf' | 'csv' | 'raw_csv';
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
  /** Null for a Facebook publish: no single view (KB-153). */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  /**
   * Null when the platform does not measure it (KB-114): TikTok and
   * Instagram watch time, TikTok follower gains. Never 0 for that.
   */
  watchTimeSeconds: number | null;
  subscribersGained: number | null;
  revenueCents: number;
  retentionData: Record<string, number> | null;
  /** Thumbnail impressions (YouTube Reporting API). */
  impressions: number;
  /** Click-through rate on impressions, 0..1. */
  ctr: number;
  /** Average view duration in seconds; null when not measured (KB-111). */
  avgViewDurationSeconds: number | null;
}

/**
 * Aggregated summary for PDF report header
 */
export interface ReportSummary {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  /**
   * Over the rows that measure it, and null when none do. `coverage` says
   * how many that was (decision #33, A; KB-111, KB-114).
   */
  totalWatchTimeSeconds: number | null;
  totalSubscribers: number | null;
  /** View-weighted over the rows that measure it. */
  avgViewDurationSeconds: number | null;
  /** Impression-weighted click-through rate, 0..1, over rows with impressions. */
  ctr: number | null;
  coverage: {
    watchTime: Coverage;
    subscribers: Coverage;
    avgViewDuration: Coverage;
  };
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

/**
 * One row of an account's report history (FILM-809)
 */
export interface GeneratedReportRecord {
  id: string;
  reportType: 'pdf' | 'csv';
  fileName: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  recordCount: number;
  createdAt: string;
}
