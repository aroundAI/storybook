import 'server-only';

import type { SubscriberCountResult } from '@kit/shared/subscribers';
import { metaFetch } from '@kit/shared/vendors';

import { MetaRateLimitError, isMetaThrottle } from '../../lib/meta-usage';
import type {
  FacebookAudience,
  FacebookInsightsInput,
  FacebookInsightsResult,
  FacebookPageViewers,
  FacebookRetentionGraph,
  FacebookVideoTotals,
} from './types';

/**
 * Facebook video insights (FILM-1720), read with a Page token through
 * `metaFetch` (Graph v26.0, token in the Authorization header).
 *
 * Four reads per video, each documented in the capability reference: the
 * video node's post and comment count (`facebook/video-fields`); its video
 * insights (`facebook/video-insights`), twice — the video metrics, then the
 * Reels ones, which Meta may refuse for a video in the player without that
 * costing the rest; the Page post's shares (`facebook/post-fields`); and the
 * post's insights (`facebook/post-insights`), the replacements Graph v25.0's
 * changelog names for the retired reach and impression metrics.
 *
 * A fifth read asks for each video's 3-second views by age and gender and
 * by country, on its own, so a refusal costs the audience and nothing else.
 *
 * A sixth read asks for the ad-break earnings (FILM-1726), on its own:
 * Meta answers them only to the admin of a Page that runs ad breaks, and a
 * refusal there must cost those four figures and nothing else.
 *
 * Not requested: Meta's own averages (`total_video_avg_time_watched`,
 * `post_video_avg_time_watched` — the Reels one counts replay time over first
 * plays and can exceed the video's length), and anything Graph v25.0 retired
 * (the reference's forbidden block).
 *
 * Shipped dark: no connection holds `read_insights` until the owner turns the
 * `facebook` analytics scope switch on, so the sync never calls this.
 */

/** Video metrics: every Facebook video. */
const videoInsightMetrics = [
  'total_video_views',
  'total_video_views_organic',
  'total_video_views_paid',
  'total_video_views_autoplayed',
  'total_video_views_clicked_to_play',
  'total_video_15s_views',
  'total_video_complete_views',
  'total_video_view_total_time',
  'total_video_retention_graph',
  'total_video_reactions_by_type_total',
];

/** Reels metrics: refused, or absent, for a video in the player. */
const reelsInsightMetrics = [
  'blue_reels_play_count',
  'fb_reels_replay_count',
  'post_video_view_time',
  'post_video_followers',
  'post_video_likes_by_reaction_type',
];

/** The audience breakdowns: 3-second views by age and gender, by country. */
const audienceInsightMetrics = [
  'total_video_views_by_age_bucket_and_gender',
  'total_video_views_by_country_id',
];

/** `page_total_media_view_unique`'s periods, as window lengths in days. */
export const FACEBOOK_PAGE_PERIODS = [
  { period: 'day', windowDays: 1 },
  { period: 'week', windowDays: 7 },
  { period: 'days_28', windowDays: 28 },
] as const;

/** Ad-break metrics (FILM-1726): Page admins only. */
const adBreakInsightMetrics = [
  'total_video_ad_break_earnings',
  'total_video_ad_break_ad_cpm',
  'total_video_ad_break_ad_impressions',
  'creator_monetization_qualified_views',
];

/** Post insights: the impression and reach replacements. */
const postInsightMetrics = ['post_media_view', 'post_total_media_view_unique'];

/** Graph error codes that mean the token cannot read this: no retry helps. */
const PERMISSION_CODES: ReadonlySet<number> = new Set([10, 190, 200]);

type InsightValue = number | Record<string, number>;

interface InsightItem {
  name?: string;
  values?: { value?: InsightValue }[];
}

interface InsightsBody {
  data?: InsightItem[];
}

/** `metric=…&period=lifetime`: every figure here is the lifetime total. */
function lifetime(metrics: readonly string[]) {
  return new URLSearchParams({ metric: metrics.join(','), period: 'lifetime' });
}

interface GraphBody {
  error?: { message?: string; code?: number };
}

/** The connection does not hold what Meta needs for this read. */
export class FacebookInsightsScopeError extends Error {
  constructor(detail: string) {
    super(
      'Facebook video insights access denied. The Page connection may be missing read_insights or the ANALYZE task: ' +
        detail,
    );
    this.name = 'FacebookInsightsScopeError';
  }
}

/** A refusal that is not about permission or rate: the figures it carries are not measured. */
class FacebookReadRefused extends Error {}

export class FacebookInsightsProvider {
  constructor(private accessToken: string) {}

  async getVideoInsights(
    input: FacebookInsightsInput,
  ): Promise<FacebookInsightsResult> {
    const { videoId } = input;

    const { accessToken: token } = this;

    const node = await this.parse<{
      post_id?: string;
      comments?: { summary?: { total_count?: number } };
    }>(
      await metaFetch(
        `/${videoId}?fields=post_id,comments.limit(0).summary(true)`,
        { token },
      ),
    );

    const [video, reels, audience] = await Promise.all([
      this.parse<InsightsBody>(
        await metaFetch(
          `/${videoId}/video_insights?${lifetime(videoInsightMetrics)}`,
          { token },
        ),
      ).then((body) => body.data ?? []),
      this.optional(async () =>
        this.parse<InsightsBody>(
          await metaFetch(
            `/${videoId}/video_insights?${lifetime(reelsInsightMetrics)}`,
            { token },
          ),
        ).then((body) => body.data ?? []),
      ),
      this.optional(async () =>
        this.parse<InsightsBody>(
          await metaFetch(
            `/${videoId}/video_insights?${lifetime(audienceInsightMetrics)}`,
            { token },
          ),
        ).then((body) => body.data ?? []),
      ),
    ]);

    const postId = node.post_id ?? null;
    const [post, postInsights] = postId
      ? await Promise.all([
          this.optional(async () =>
            this.parse<{ shares?: { count?: number } }>(
              await metaFetch(`/${postId}?fields=shares`, { token }),
            ),
          ),
          this.optional(async () =>
            this.parse<InsightsBody>(
              await metaFetch(
                `/${postId}/insights?${lifetime(postInsightMetrics)}`,
                { token },
              ),
            ).then((body) => body.data ?? []),
          ),
        ])
      : [null, null];

    const metric = (items: InsightItem[] | null, name: string) =>
      items?.find((item) => item.name === name)?.values?.[0]?.value;

    const count = (items: InsightItem[] | null, name: string) => {
      const value = metric(items, name);
      return typeof value === 'number' ? value : null;
    };

    const reactions = (items: InsightItem[] | null, name: string) => {
      const value = metric(items, name);
      return value !== undefined && typeof value === 'object'
        ? Object.values(value).reduce((sum, n) => sum + n, 0)
        : null;
    };

    const totals: FacebookVideoTotals = {
      reactions:
        reactions(reels, 'post_video_likes_by_reaction_type') ??
        reactions(video, 'total_video_reactions_by_type_total'),
      comments: node.comments?.summary?.total_count ?? null,
      // Meta leaves `shares` off a post nobody has shared (inferred: the
      // Post reference does not say; see the reference's ledger).
      shares: post ? (post.shares?.count ?? 0) : null,
      mediaViews: count(postInsights, 'post_media_view'),
      uniqueViewers: count(postInsights, 'post_total_media_view_unique'),
      firstPlays: count(reels, 'blue_reels_play_count'),
      replayCount: count(reels, 'fb_reels_replay_count'),
      threeSecondViews: count(video, 'total_video_views'),
      threeSecondViewsOrganic: count(video, 'total_video_views_organic'),
      threeSecondViewsPaid: count(video, 'total_video_views_paid'),
      threeSecondViewsAutoplayed: count(video, 'total_video_views_autoplayed'),
      threeSecondViewsClickedToPlay: count(
        video,
        'total_video_views_clicked_to_play',
      ),
      fifteenSecondViews: count(video, 'total_video_15s_views'),
      completeViews: count(video, 'total_video_complete_views'),
      viewTimeMs:
        count(reels, 'post_video_view_time') ??
        count(video, 'total_video_view_total_time'),
      follows: count(reels, 'post_video_followers'),
    };

    return {
      videoId,
      postId,
      totals,
      retention: retentionGraph(metric(video, 'total_video_retention_graph')),
      audience: audienceOf(
        metric(audience, 'total_video_views_by_age_bucket_and_gender'),
        metric(audience, 'total_video_views_by_country_id'),
      ),
      adBreaks: await this.adBreaks(videoId, (items, name) =>
        count(items, name),
      ),
    };
  }

  /**
   * The ad-break read. Never throws for a refusal: a Page whose earnings
   * this token may not read still has its views, watch time and shares.
   * A rate limit is not a refusal, and still stops the sync.
   */
  private async adBreaks(
    videoId: string,
    count: (items: InsightItem[] | null, name: string) => number | null,
  ): Promise<FacebookInsightsResult['adBreaks']> {
    const unread = (access: 'account_type_gated' | 'unavailable') => ({
      access,
      earnings: null,
      cpm: null,
      adImpressions: null,
      qualifiedViews: null,
    });

    let items: InsightItem[];

    try {
      items = await this.parse<InsightsBody>(
        await metaFetch(
          `/${videoId}/video_insights?${lifetime(adBreakInsightMetrics)}`,
          { token: this.accessToken },
        ),
      ).then((body) => body.data ?? []);
    } catch (error) {
      if (error instanceof FacebookInsightsScopeError) {
        return unread('account_type_gated');
      }
      if (error instanceof FacebookReadRefused) return unread('unavailable');
      throw error;
    }

    return {
      access: 'authorised',
      earnings: count(items, 'total_video_ad_break_earnings'),
      cpm: count(items, 'total_video_ad_break_ad_cpm'),
      adImpressions: count(items, 'total_video_ad_break_ad_impressions'),
      qualifiedViews: count(items, 'creator_monetization_qualified_views'),
    };
  }

  /**
   * The Page's follower count (`facebook/page-fields`). Unavailable, never
   * 0, when Meta answers without one or refuses. A rate limit still throws.
   */
  async getPageFollowerCount(pageId: string): Promise<SubscriberCountResult> {
    try {
      const body = await this.parse<{ followers_count?: unknown }>(
        await metaFetch(`/${pageId}?fields=followers_count`, {
          token: this.accessToken,
        }),
      );

      return typeof body.followers_count === 'number'
        ? { ok: true, count: body.followers_count }
        : { ok: false, reason: 'unavailable' };
    } catch (error) {
      if (error instanceof MetaRateLimitError) throw error;
      return { ok: false, reason: 'unavailable' };
    }
  }

  /**
   * How many different people viewed the Page's content over the day, the
   * 7 days and the 28 days ending `asOf` (`page_total_media_view_unique`).
   * Unique viewers do not add up across days, so each window is Meta's own
   * answer. The day is Meta's, which ends at midnight Pacific (inferred:
   * the Insights reference gives `end_time` without saying whose midnight).
   *
   * A refused or empty period is null, never 0. Permission and rate-limit
   * errors throw: the caller stops for this Page.
   */
  async getPageUniqueViewers(
    pageId: string,
    asOf: string,
  ): Promise<FacebookPageViewers[]> {
    const since = Date.parse(`${asOf}T00:00:00Z`) / 1000;

    return Promise.all(
      FACEBOOK_PAGE_PERIODS.map(async ({ period, windowDays }) => {
        const items = await this.optional(async () =>
          this.parse<{
            data?: { name?: string; values?: { value?: unknown }[] }[];
          }>(
            await metaFetch(
              `/${pageId}/insights?` +
                new URLSearchParams({
                  metric: 'page_total_media_view_unique',
                  period,
                  since: String(since),
                  until: String(since + 86_400),
                }),
              { token: this.accessToken },
            ),
          ).then((body) => body.data ?? []),
        );
        const value = items
          ?.find((item) => item.name === 'page_total_media_view_unique')
          ?.values?.at(-1)?.value;

        return {
          windowDays,
          viewers: typeof value === 'number' ? value : null,
        };
      }),
    );
  }

  /** A read whose refusal loses only its own figures. */
  private async optional<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof FacebookReadRefused) return null;
      throw error;
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    const body = (await response.json().catch(() => ({}))) as T & GraphBody;
    const code = body.error?.code;
    const message = body.error?.message ?? `HTTP ${response.status}`;

    if (isMetaThrottle(code)) {
      throw new MetaRateLimitError(code, message);
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      (code !== undefined && PERMISSION_CODES.has(code))
    ) {
      throw new FacebookInsightsScopeError(message);
    }
    if (!response.ok || body.error) {
      throw new FacebookReadRefused(message);
    }

    return body;
  }
}

/**
 * Meta's graph is an object of interval → share. Read as fractions of 1, the
 * way the 40-interval description reads; a graph with any value above 1 is
 * in some other unit nobody has confirmed, and is dropped rather than scaled.
 */
function retentionGraph(value: unknown): FacebookRetentionGraph | null {
  if (!value || typeof value !== 'object') return null;

  const points = Object.entries(value as Record<string, unknown>)
    .map(([key, share]) => [Number(key), share] as const)
    .filter(
      (point): point is readonly [number, number] =>
        Number.isInteger(point[0]) && typeof point[1] === 'number',
    )
    .sort((a, b) => a[0] - b[0]);

  const last = points.at(-1)?.[0];
  if (!last || points.some(([, share]) => share < 0 || share > 1)) {
    return null;
  }

  return points.map(([interval, share]) => ({
    elapsedRatio: interval / last,
    watchRatio: share,
  }));
}

const AGE_GENDER_KEY = /^([FMU])\.(\d{2}-\d{2}|\d{2}\+)$/;
const COUNTRY_KEY = /^[A-Z]{2}$/;

function counts(value: unknown): [string, number][] {
  return value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && entry[1] >= 0,
      )
    : [];
}

/**
 * Meta's breakdowns, `{F|M|U}.{age}` → 3-second views and country → 3-second
 * views. A key in neither shape is dropped rather than guessed at, and a
 * read Meta refused or answered with neither breakdown is null, not an
 * empty audience.
 */
function audienceOf(
  ageGender: unknown,
  countries: unknown,
): FacebookAudience | null {
  if (ageGender === undefined && countries === undefined) return null;

  return {
    ageGender: counts(ageGender).flatMap(([key, views]) => {
      const match = AGE_GENDER_KEY.exec(key);
      return match
        ? [{ gender: match[1] as 'F' | 'M' | 'U', ageGroup: match[2]!, views }]
        : [];
    }),
    countries: counts(countries).flatMap(([country, views]) =>
      COUNTRY_KEY.test(country) ? [{ country, views }] : [],
    ),
  };
}

export function createFacebookInsightsProvider(
  pageAccessToken: string,
): FacebookInsightsProvider {
  return new FacebookInsightsProvider(pageAccessToken);
}
