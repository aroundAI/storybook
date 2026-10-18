/**
 * The figures a morning report reads (FILM-1734), as types and the pure
 * rules that build them. Client-safe: the readers are in
 * `server/daily-figures.ts`.
 *
 * A figure is a number or null, and null means "not measured" — by this
 * platform, on this surface, from this source, or because the store was not
 * read. It is never 0 for any of those: a 0 is a measurement.
 *
 * Every row carries one `source`, and every figure on the row came from that
 * source. Where two sources measure the same video on the same day (YouTube's
 * Data API counts and its Analytics API day), they are two rows: nothing is
 * merged across sources, and nothing is added up across them.
 */

export type Figure = number | null;

/**
 * Where a row's figures came from.
 *
 * - `data_api`      YouTube Data API `videos.list`/`channels.list` statistics:
 *                   live lifetime counts; a day is the change between two
 *                   daily snapshots
 * - `analytics_api` YouTube Analytics API, by day (1–2 days behind)
 * - `reporting_csv` YouTube Reporting API bulk reports (about 48 hours behind)
 * - `graph_api`     Meta's Graph API (Instagram, Facebook)
 * - `tiktok_api`, `x_api`  those platforms' own APIs
 */
export type Source =
  | 'data_api'
  | 'analytics_api'
  | 'reporting_csv'
  | 'graph_api'
  | 'tiktok_api'
  | 'x_api';

/** The figures of one video, for a day or for its lifetime. */
export interface VideoFigures {
  views: Figure;
  /** YouTube engaged views (the pre-2026-08-27 view count, continued). */
  engagedViews: Figure;
  /** Unique accounts reached: Instagram's reach, Facebook's unique viewers. */
  reach: Figure;
  likes: Figure;
  /** YouTube only, and only to the channel owner. */
  dislikes: Figure;
  comments: Figure;
  shares: Figure;
  saves: Figure;
  reposts: Figure;
  watchTimeSeconds: Figure;
  avgViewDurationSeconds: Figure;
  /** 0–100. */
  avgPercentViewed: Figure;
  /** YouTube subscribers gained from this video. */
  subscribersGained: Figure;
  subscribersLost: Figure;
  /** Instagram and Facebook: follows credited to this post. */
  follows: Figure;
  /** Instagram: profile visits from this post. */
  profileVisits: Figure;
  /** YouTube thumbnail impressions. */
  impressions: Figure;
  /** Impressions click-through rate as a ratio, 0–1. */
  impressionCtr: Figure;
  /** Instagram Reels average watch time, milliseconds. Lifetime only. */
  reelsAvgWatchTimeMs: Figure;
  /** Instagram Reels skip rate, as Meta reports it (unscaled). Lifetime only. */
  reelsSkipRate: Figure;
  /** Facebook 3-second views. */
  fbViews3s: Figure;
  /** Facebook organic 3-second views. */
  fbViewsOrganic: Figure;
  /** Facebook complete views (97% or more of the video). */
  fbViewsComplete: Figure;
}

export interface VideoDailyFigures extends VideoFigures {
  publishId: string;
  /** The platform's data date, YYYY-MM-DD. */
  date: string;
  platform: string;
  source: Source;
}

export interface VideoLifetimeFigures extends VideoFigures {
  publishId: string;
  platform: string;
  /** The moment the figures are as of: the snapshot fetch, or the last day summed. */
  asOf: string;
  source: Source;
}

export interface ChannelDailyFigures {
  connectionId: string;
  platform: string;
  date: string;
  views: Figure;
  watchTimeSeconds: Figure;
  likes: Figure;
  dislikes: Figure;
  comments: Figure;
  shares: Figure;
  subscribersGained: Figure;
  subscribersLost: Figure;
  /** The channel's total on that day (YouTube rounds it above 1,000). */
  subscribersTotal: Figure;
  /** YouTube: the channel's lifetime views that day (`channels.list`). */
  lifetimeViews: Figure;
  /** YouTube: the channel's public videos that day. */
  lifetimeVideos: Figure;
  /** The account's unique reach that day (Instagram). */
  reach: Figure;
  /** The account's views that day (Instagram). */
  accountViews: Figure;
  source: Source;
}

export interface DataFreshness {
  connectionId: string;
  platform: string;
  /** The newest day the platform's figures run through; null if none yet. */
  lastDataDate: string | null;
  /** The last successful sync of any of the channel's videos. */
  lastSyncAt: string | null;
  /** The latest attempt's outcome: success, failed, scope_error, rate_limited, never_synced. */
  status: string;
  error: string | null;
  needsReauth: boolean;
}

/**
 * One key of one audience dimension for one video. `basis` says whose share
 * it is: Instagram's demographics are the account's followers, not the
 * post's viewers.
 */
export interface AudienceShare {
  publishId: string;
  platform: string;
  key: string;
  views: Figure;
  /** 0–100. */
  percentage: Figure;
  basis: 'viewers' | 'followers';
}

export interface VideoAudienceBreakdown {
  age: AudienceShare[];
  gender: AudienceShare[];
  country: AudienceShare[];
  city: AudienceShare[];
  device: AudienceShare[];
  os: AudienceShare[];
  subscribedStatus: AudienceShare[];
}

/** Why every figure is null when the analytics store was not read. */
export const UNMEASURED_CLICKHOUSE_OFF =
  'Not measured: the analytics store (ClickHouse) is switched off here, so no figure was read.';

export const NO_VIDEO_FIGURES: VideoFigures = {
  views: null,
  engagedViews: null,
  reach: null,
  likes: null,
  dislikes: null,
  comments: null,
  shares: null,
  saves: null,
  reposts: null,
  watchTimeSeconds: null,
  avgViewDurationSeconds: null,
  avgPercentViewed: null,
  subscribersGained: null,
  subscribersLost: null,
  follows: null,
  profileVisits: null,
  impressions: null,
  impressionCtr: null,
  reelsAvgWatchTimeMs: null,
  reelsSkipRate: null,
  fbViews3s: null,
  fbViewsOrganic: null,
  fbViewsComplete: null,
};

export const NO_CHANNEL_FIGURES = {
  views: null,
  watchTimeSeconds: null,
  likes: null,
  dislikes: null,
  comments: null,
  shares: null,
  subscribersGained: null,
  subscribersLost: null,
  subscribersTotal: null,
  lifetimeViews: null,
  lifetimeVideos: null,
  reach: null,
  accountViews: null,
} satisfies Omit<
  ChannelDailyFigures,
  'connectionId' | 'platform' | 'date' | 'source'
>;

/**
 * The source a platform's per-post figures come from, where only one does.
 * YouTube has three, so it has none here: each YouTube row names its own.
 */
export function platformSource(platform: string): Source {
  switch (platform) {
    case 'instagram':
    case 'facebook':
      return 'graph_api';
    case 'tiktok':
      return 'tiktok_api';
    case 'twitter':
      return 'x_api';
    default:
      return 'analytics_api';
  }
}

/**
 * Which of an audience row's two figures the platform reports for a
 * dimension, mirroring what the sync stores (`buildAudienceRows`,
 * `buildFacebookAudienceRows`): a stored 0 in the other is a placeholder,
 * not a measurement. YouTube reports age and gender as shares of views, and
 * city, device, OS and subscribed status as views; TikTok only shares;
 * Instagram only counts — of the account's followers, not the post's
 * viewers; Facebook 3-second views and their share.
 */
export function audienceMeasures(
  platform: string,
  dimension: string,
): { views: boolean; percentage: boolean; basis: 'viewers' | 'followers' } {
  switch (platform) {
    case 'youtube':
      return {
        views: dimension !== 'age_group' && dimension !== 'gender',
        percentage:
          dimension === 'age_group' ||
          dimension === 'gender' ||
          dimension === 'country',
        basis: 'viewers',
      };
    case 'tiktok':
      return { views: false, percentage: true, basis: 'viewers' };
    case 'instagram':
      return { views: true, percentage: false, basis: 'followers' };
    case 'facebook':
      return { views: true, percentage: true, basis: 'viewers' };
    default:
      return { views: false, percentage: false, basis: 'viewers' };
  }
}

/**
 * A difference between two lifetime counts: the day's change between the
 * day's last snapshot and the previous day's. Null when either is null —
 * subtracting from nothing would date a whole lifetime to one day. Not
 * clamped: a platform that took likes or spam views back reports a fall,
 * and the report says so rather than storing 0.
 */
export function countChange(current: Figure, previous: Figure): Figure {
  return current === null || previous === null ? null : current - previous;
}

/** The calendar days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);

  for (
    let day = Date.parse(`${from}T00:00:00Z`);
    day <= end;
    day += 86_400_000
  ) {
    days.push(new Date(day).toISOString().slice(0, 10));
  }

  return days;
}

/** The longest range one daily read accepts. */
export const MAX_FIGURE_DAYS = 400;

/** The day before a YYYY-MM-DD day. */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}
