/**
 * Aggregated analytics totals for metric cards display
 */
export interface AnalyticsTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
  contentCount: number;
}

/**
 * Platform-specific metrics breakdown
 */
export interface PlatformMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Daily metrics data point for time series charts
 */
export interface DailyMetric {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  byPlatform?: Record<string, PlatformMetrics>;
}

/**
 * Platform-specific metrics with platform identifier
 */
export interface PlatformBreakdown {
  platform: 'youtube' | 'tiktok' | 'instagram';
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Top performing content item
 */
export interface TopContent {
  id: string;
  title: string;
  thumbnailUrl?: string;
  views: number;
  likes: number;
  engagementRate: number;
  platform: string;
}

/**
 * Audience demographics and geography data
 */
export interface AudienceData {
  demographics?: {
    ageGroups?: Record<string, number>;
    genders?: Record<string, number>;
  };
  geography?: Record<string, number>;
}

/**
 * Unified aggregate analytics for AI insights and dashboard
 */
export interface AggregateAnalytics {
  totals: AnalyticsTotals;
  previousPeriodTotals?: AnalyticsTotals;
  platformMetrics?: PlatformBreakdown[];
  topContent?: TopContent[];
  audience?: AudienceData;
  contentCount: number;
  avgEngagementRate: number;
}

/**
 * AI-generated insights result
 */
export interface InsightsResult {
  summary: string;
  trends: string[];
  contentRecommendations: string[];
  postingStrategy: string[];
  audienceInsights: string[];
  topPerformers: Array<{
    title: string;
    thumbnailUrl?: string;
    analysis: string;
  }>;
  actionItems: string[];
}
