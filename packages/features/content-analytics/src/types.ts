/**
 * Aggregated analytics totals for metric cards display
 */
export interface AnalyticsTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** Saves (bookmarks) - primarily TikTok and Instagram */
  saves?: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
  /** Ad revenue portion (YouTube) */
  adRevenueCents?: number;
  /** YouTube Premium revenue portion */
  redPartnerRevenueCents?: number;
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
 * Extended audience data for detailed insights
 * Includes device type, peak activity, interests
 */
export interface ExtendedAudienceData {
  /** Device type percentages (mobile, desktop, tablet, tv, gameConsole) */
  deviceType?: {
    mobile: number;
    desktop: number;
    tablet: number;
    tv?: number;
    gameConsole?: number;
  };
  /** Operating system breakdown (iOS, Android, Windows, etc.) */
  operatingSystem?: Record<string, number>;
  /** City-level geography data */
  cityGeography?: Array<{ city: string; views: number }>;
  /** Subscribed vs non-subscribed viewer breakdown */
  subscribedStatus?: {
    subscribed: number;
    notSubscribed: number;
  };
  /** Peak activity heatmap: 4 time slots x 7 days, values 0-1 */
  peakActivity?: number[][];
  /** Audience interest tags */
  interests?: string[];
  /** Content affinity data */
  contentAffinity?: {
    label: string;
    percentage: number;
    thumbnailUrl?: string;
  };
}

/**
 * Share breakdown by type (reposts, quotes, saves, shares)
 */
export interface ShareBreakdown {
  reposts: number;
  quotes: number;
  saves: number;
  shares: number;
}

/**
 * Revenue breakdown by source
 */
export interface RevenueBreakdown {
  adRevenue: number;
  /** YouTube Premium (Red Partner) revenue */
  redPartnerRevenue?: number;
  memberships: number;
  superChats: number;
  merchandise: number;
}

/**
 * Geography breakdown with country names and percentages
 */
export interface GeographyBreakdown {
  country: string;
  percentage: number;
  flagEmoji?: string;
}

/**
 * Unified aggregate analytics for AI insights and dashboard
 */
export interface AggregateAnalytics {
  totals: AnalyticsTotals;
  previousPeriodTotals?: AnalyticsTotals;
  platformMetrics?: PlatformBreakdown[];
  topContent?: TopContent[];
  audience?: AudienceData & ExtendedAudienceData;
  contentCount: number;
  avgEngagementRate: number;
  /** Share breakdown by type */
  shareBreakdown?: ShareBreakdown;
  /** Revenue breakdown by source */
  revenueBreakdown?: RevenueBreakdown;
  /** Top regions with flag emojis */
  topRegions?: GeographyBreakdown[];
  /** Daily time series data for sparklines */
  dailyData?: DailyMetric[];
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
