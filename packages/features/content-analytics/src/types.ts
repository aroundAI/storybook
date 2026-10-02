import type { DenominatorStamp } from '@kit/clickhouse';

import type { EstimatedRevenue } from './lib/estimated-revenue';
import type { Views } from './lib/views';

/**
 * Aggregated analytics totals for metric cards display
 */
export interface AnalyticsTotals {
  /** Null where every row is a platform with no single view (KB-153). */
  views: Views;
  likes: number;
  comments: number;
  /** Null when no row measured it: X reports no shares (FILM-1727). */
  shares: number | null;
  /** Saves (bookmarks) - primarily TikTok and Instagram */
  saves?: number;
  /**
   * Null when not measured — TikTok reports no watch time — and the card
   * says so rather than showing 0m (KB-149).
   */
  watchTimeSeconds: number | null;
  /** Null when not measured: TikTok and Instagram report none (KB-149). */
  subscribersGained: number | null;
  /** The platform's estimate in USD; null where no day was measured (FILM-1726). */
  revenueCents: EstimatedRevenue;
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
  /** Null where every row is a platform with no single view (KB-153). */
  views: Views;
  likes: number;
  comments: number;
  /** Null where the platform reports no shares: X (FILM-1727). */
  shares: number | null;
}

/**
 * Daily metrics data point for time series charts
 */
export interface DailyMetric {
  date: string;
  /** Null where every row is a platform with no single view (KB-153). */
  views: Views;
  likes: number;
  comments: number;
  shares: number;
  byPlatform?: Record<string, PlatformMetrics>;
}

/**
 * Platform-specific metrics with platform identifier
 */
export interface PlatformBreakdown {
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  /** Null where every row is a platform with no single view (KB-153). */
  views: Views;
  likes: number;
  comments: number;
  /** Null where the platform reports no shares: X (FILM-1727). */
  shares: number | null;
}

/**
 * Top performing content item
 */
export interface TopContent {
  id: string;
  title: string;
  thumbnailUrl?: string;
  /** Null where every row is a platform with no single view (KB-153). */
  views: Views;
  likes: number;
  /** Null where views are not measured: there is nothing to divide by. */
  engagementRate: number | null;
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
 * Extended audience data for detailed insights.
 *
 * Every field here has a provider field and a `video_audience` dimension
 * behind it. `peakActivity`, `interests` and `contentAffinity` had neither,
 * and existed only so three constants had something to fall back *from*
 * (FILM-1701). Wanting them back means a provider field, an
 * `AudienceDimension` slot, a writer and a backfill — not a field here.
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
 * A measured period-over-period change. Only built where the previous
 * period has a figure above zero: a change from nothing is not a percentage.
 * `platform` is `all` for the platforms currently selected.
 */
export interface TrendFact {
  metric: 'views' | 'likes' | 'comments' | 'shares';
  platform: string;
  current: number;
  previous: number;
  changePercent: number;
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
  trendFacts?: TrendFact[];
  contentCount: number;
  avgEngagementRate: number;
  /** What `avgEngagementRate` divided by (FILM-1732), for the page's own sentence. */
  avgEngagementDenominator?: DenominatorStamp;
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
