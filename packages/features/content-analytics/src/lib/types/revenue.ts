/**
 * Revenue Tracking Types - FILM-810
 * Types for revenue analytics and monetization data
 */

/**
 * Detailed breakdown of revenue by source type
 */
export interface RevenueBreakdown {
  adRevenueCents?: number;
  membershipRevenueCents?: number;
  superChatRevenueCents?: number;
  creatorFundCents?: number;
  bonusesCents?: number;
  tipsOtherCents?: number;
}

/**
 * A single revenue record for a publish on a specific date
 */
export interface RevenueRecord {
  id: string;
  publishId: string;
  platform:
    | 'youtube'
    | 'tiktok'
    | 'instagram'
    | 'facebook'
    | 'twitter'
    | 'manual';
  date: string; // ISO date (YYYY-MM-DD)
  revenueCents: number;
  currency: string; // ISO 4217 code
  source: 'api' | 'manual';
  breakdown?: RevenueBreakdown;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregated revenue summary for a period, **in one currency** (KB-12).
 *
 * Every cents field here is an amount of `currency` and of nothing else. An
 * account paid in two currencies has two of these — see
 * `createRevenueSummaryFold` — because there are no exchange rates to make
 * one from. `currency` is null only for rows written without a code.
 */
export interface RevenueSummary {
  totalRevenueCents: number;
  currency: string | null;
  period: {
    start: string;
    end: string;
  };
  byPlatform: Record<string, number>;
  byContent: Record<string, number>;
  byType: Record<string, number>;
  /** Cents per 1000 views, all revenue categories. Alias of allInRpmCents. */
  rpm: number;
  /** Views for every published video in the window, revenue-bearing or not. */
  totalViews: number;
  /** Platform payouts: ads + Premium. */
  adsRevenueCents: number;
  /** Everything the channel built itself: sponsorship, product, licensing… */
  nonAdRevenueCents: number;
  /**
   * Payout share of **positive** revenue, 0-100, and 0 when there is no
   * positive revenue.
   *
   * Not a share of `totalRevenueCents`, which is signed: a clawback month
   * would otherwise put this above 100.
   *
   * **The cents fields beside this cannot reconstruct it.** They stay
   * signed while this filters to positives, so with
   * `{ ads: -5000, sponsorship: 1000 }` the payload reads
   * `adsRevenueCents: -5000`, `positiveRevenueCents: 1000` and
   * `adsSharePercent: 0` — dividing one by the other gives -500%. Read
   * this field; do not derive it.
   */
  adsSharePercent: number;
  /** The complement of `adsSharePercent`, over the same denominator. */
  nonAdSharePercent: number;
  /**
   * Sum of the positive category buckets — the denominator the two share
   * fields use, and what "100%" refers to. Differs from
   * `totalRevenueCents` whenever a category is negative.
   */
  positiveRevenueCents: number;
  /** Cents per 1000 views from ads + Premium only. */
  adsRpmCents: number;
  /** Cents per 1000 views across every category. */
  allInRpmCents: number;
  averageDailyRevenueCents: number;
  trend: 'up' | 'down' | 'stable';
  trendPercent: number;
}

/**
 * Revenue projection based on historical data, in one currency (KB-12):
 * the days counted and the confidence are that currency's own.
 */
export interface RevenueProjection {
  currency: string | null;
  estimatedMonthlyRevenueCents: number;
  estimatedYearlyRevenueCents: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  basedOnDays: number;
  factors: {
    factor: string;
    impact: number; // -100 to 100
    description: string;
  }[];
}

/**
 * Generated revenue report
 */
export interface RevenueReport {
  id: string;
  accountId: string;
  period: 'monthly' | 'quarterly' | 'yearly' | 'custom';
  startDate: string;
  endDate: string;
  /** One per currency, largest first. Empty when nothing was recorded. */
  summaries: RevenueSummary[];
  /** Ranked within a currency: there is no rate to rank across two. */
  topPerformers: TopRevenueContentByCurrency[];
  platformBreakdown: {
    currency: string | null;
    platform: string;
    revenueCents: number;
    /** Share of this currency's total, never of a sum across currencies. */
    percentOfTotal: number;
    contentCount: number;
  }[];
  generatedAt: Date;
  format?: 'pdf' | 'csv' | 'json';
}

/**
 * Input for manual revenue entry
 */
export interface ManualRevenueEntry {
  publishId: string;
  date: string;
  revenueCents: number;
  currency?: string;
  notes?: string;
}

/**
 * Revenue time series data point for charts
 */
export interface RevenueDataPoint {
  date: string;
  revenueCents: number;
  platform?: string;
}

/** One currency's daily series, zero-filled across the requested range. */
export interface RevenueSeries {
  currency: string | null;
  points: RevenueDataPoint[];
}

/**
 * Top content item by revenue. `revenueCents` and `rpm` are in the currency
 * of the `TopRevenueContentByCurrency` that holds the item.
 */
export interface TopRevenueContent {
  publishId: string;
  episodeId: string;
  title: string;
  platform: string;
  revenueCents: number;
  views: number;
  rpm: number;
  thumbnailUrl?: string;
}

/** One currency's ranking. A video paid in two currencies is in both. */
export interface TopRevenueContentByCurrency {
  currency: string | null;
  items: TopRevenueContent[];
}

/**
 * Revenue alert notification
 */
export interface RevenueAlert {
  id: string;
  accountId: string;
  alertType: 'threshold_reached' | 'significant_change' | 'policy_change';
  title: string;
  message?: string;
  severity: 'info' | 'warning' | 'critical';
  relatedData?: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}
