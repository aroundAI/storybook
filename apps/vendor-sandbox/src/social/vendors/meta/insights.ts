import { sendJson } from '../../../http';
import { mediaUrl } from '../../media';
import type { SocialRoute } from '../../server';
import type { SocialAccount, SocialObject, SocialState } from '../../state';
import { graphError, graphPath, metaAuthorize } from './errors';
import { meterInstagramCall } from './usage';

/**
 * The Instagram reads the app makes on the Facebook Login path
 * (`instagram-insights.ts`, the connect callback):
 *
 * - `GET /{ig-user-id}?fields=…` — `instagram/user-fields`;
 * - `GET /{ig-media-id}?fields=media_type,media_product_type,reposts_count` —
 *   `instagram/media-fields`;
 * - `GET /{ig-media-id}/insights?metric=…` — `instagram/media-insights`;
 * - `GET /{ig-user-id}/insights?metric=…&metric_type=total_value` — reach
 *   per window (split by `follow_type`), views, and `follower_demographics`
 *   (`instagram/user-insights`, `…-breakdowns`).
 *
 * Unique reach behaves as Meta's does, not as a sum: an account reached
 * twice counts once. It saturates towards the account's reachable pool, so
 * it never exceeds views, a longer window is at least a shorter one ending
 * the same day, and it is less than the sum of the days it covers.
 * Followers plus non-followers equal the total. Windows longer than 30 days
 * are refused, as Meta refuses them.
 */

const INSIGHTS_SCOPE = ['instagram_manage_insights'];

/**
 * Reposts per share. The growth model draws no repost ratio of its own —
 * adding one would move every seeded figure — so a post's `reposts_count` is
 * a fixed share of its shares: lifetime, and never falling, as Meta's is.
 */
const REPOSTS_PER_SHARE = 0.4;

/**
 * The all-surface aggregates (`total_*_count`, FILM-1722) fold in boosted
 * placements on top of the organic figure. The growth model draws no paid
 * share, so they are the organic cumulative plus a fixed boosted share:
 * never below the organic figure, and lifetime like it.
 */
const BOOSTED_SHARE = 0.25;
const BASIC_SCOPE = ['instagram_basic', 'instagram_manage_insights'];

/** Meta's longest `since`/`until` span for account insights. */
export const MAX_WINDOW_S = 30 * 86_400;

/** The 2026 Reels watch-time unit, as Meta's own titles label it. */
const MS = 1000;

/**
 * The share of a Reel's views skipped in the first 3 seconds. The growth
 * model draws no skip behaviour of its own, so this is fixed. Meta calls
 * `reels_skip_rate` a percentage and shows no value, so the sandbox serves
 * one on 0–100; the app stores it unscaled either way, and FILM-1714
 * withholds it until a live response settles the scale (KB-151).
 */
const SKIP_PERCENT = 31.5;

function mediaObjects(social: SocialState, account: SocialAccount) {
  // A seeded post the app already knew is adopted with no account; there is
  // one Instagram account per sandbox, so it is this one's.
  return social
    .listObjects('instagram')
    .filter((o) => o.accountId === account.id || o.accountId === null);
}

/** Views in [fromMs, toMs) across the account's posts. */
function viewsBetween(
  social: SocialState,
  account: SocialAccount,
  fromMs: number,
  toMs: number,
) {
  return mediaObjects(social, account).reduce(
    (sum, o) =>
      sum +
      Math.max(
        0,
        social.cumulative(o, 'views', toMs) -
          social.cumulative(o, 'views', fromMs),
      ),
    0,
  );
}

/** How many distinct accounts an audience of this size can hold. */
export function reachablePool(followers: number) {
  return followers * 3 + 500;
}

/**
 * Distinct accounts among `views` impressions over a pool of `pool`.
 *
 * Concave and zero at zero, so a window is never more than the sum of its
 * days — the union of the days' audiences — and rounded up, so that still
 * holds after rounding (the sum of ceilings is at least the ceiling of the
 * sum). Never more than views.
 */
export function uniqueReach(views: number, pool: number) {
  if (views <= 0) return 0;
  return Math.min(views, Math.ceil(pool * (1 - Math.exp(-views / pool))));
}

export interface AccountReach {
  total: number;
  followers: number;
  nonFollowers: number;
}

export function accountReach(
  social: SocialState,
  account: SocialAccount,
  fromMs: number,
  toMs: number,
): AccountReach {
  const followers = social.followers(account, toMs);
  const pool = reachablePool(followers);
  const total = uniqueReach(viewsBetween(social, account, fromMs, toMs), pool);
  const fromFollowers = Math.min(
    followers,
    Math.floor((total * followers) / pool),
  );

  return {
    total,
    followers: fromFollowers,
    nonFollowers: total - fromFollowers,
  };
}

/** A post's lifetime unique reach, over the same pool as its account's. */
export function mediaReach(
  social: SocialState,
  account: SocialAccount,
  object: SocialObject,
  atMs = social.now(),
) {
  return uniqueReach(
    social.cumulative(object, 'views', atMs),
    reachablePool(social.followers(account, atMs)),
  );
}

/** An Instagram-style shortcode, derived from the post's id's digits. */
function shortcode(id: string) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const digits = id.replace(/\D/g, '');
  let out = '';
  for (let i = 0; i < 11; i++) {
    const pair = Number(
      digits.slice((i * 2) % digits.length, ((i * 2) % digits.length) + 2) ||
        '0',
    );
    out += alphabet[(pair + i * 7) % alphabet.length];
  }
  return out;
}

function fieldsOf(url: URL) {
  return (url.searchParams.get('fields') ?? '').split(',').filter(Boolean);
}

/** GET /{ig-user-id}?fields=… and GET /{ig-media-id}?fields=… */
const nodes: SocialRoute = ({ url, method, req, res, social, self, about }) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)$/.exec(path)?.[1];
  if (method !== 'GET' || !id) return false;

  const instagram = social.signedIn('instagram');

  if (id === instagram.id) {
    if (!metaAuthorize(url, req, res, social, BASIC_SCOPE)) return true;
    const fields: Record<string, unknown> = {
      username: instagram.handle,
      name: instagram.name,
      profile_picture_url: mediaUrl(
        self,
        'avatar',
        instagram.id,
        instagram.name,
      ),
      followers_count: social.followers(instagram),
    };
    sendJson(res, 200, {
      ...Object.fromEntries(
        fieldsOf(url)
          .filter((f) => f in fields)
          .map((f) => [f, fields[f]]),
      ),
      id: instagram.id,
    });
    return true;
  }

  // Any other numeric id but the Page's is a post: this sandbox's own, or
  // one the app published before it ran (adopted on first sight).
  if (id === social.signedIn('facebook').id) return false;
  if (!metaAuthorize(url, req, res, social, BASIC_SCOPE)) return true;
  about(id);
  const post = social.object('instagram', id);
  const fields: Record<string, unknown> = {
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    permalink: `https://www.instagram.com/reel/${shortcode(post.id)}/`,
    reposts_count: Math.floor(
      social.cumulative(post, 'shares') * REPOSTS_PER_SHARE,
    ),
    ...Object.fromEntries(
      (
        [
          ['total_views_count', 'views'],
          ['total_like_count', 'likes'],
          ['total_comments_count', 'comments'],
        ] as const
      ).map(([field, organic]) => {
        const count = social.cumulative(post, organic);

        return [field, count + Math.floor(count * BOOSTED_SHARE)];
      }),
    ),
  };
  sendJson(res, 200, {
    ...Object.fromEntries(
      fieldsOf(url)
        .filter((f) => f in fields)
        .map((f) => [f, fields[f]]),
    ),
    id,
  });
  return true;
};

const MEDIA_METRICS = new Set([
  'views',
  'reach',
  'total_interactions',
  'likes',
  'comments',
  'saved',
  'shares',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'reels_skip_rate',
]);

/** GET /{ig-media-id}/insights?metric=… — lifetime, per post. */
const mediaInsights: SocialRoute = ({
  url,
  method,
  req,
  res,
  social,
  about,
}) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)\/insights$/.exec(path)?.[1];
  const instagram = social.signedIn('instagram');
  if (method !== 'GET' || !id || id === instagram.id) return false;

  if (!metaAuthorize(url, req, res, social, INSIGHTS_SCOPE)) return true;
  if (
    !meterInstagramCall(
      social,
      res,
      instagram.id,
      social.signedIn('facebook').id,
    )
  ) {
    return true;
  }
  about(id);

  const metrics = (url.searchParams.get('metric') ?? '')
    .split(',')
    .filter(Boolean);
  const unknown = metrics.find((m) => !MEDIA_METRICS.has(m));
  if (metrics.length === 0 || unknown) {
    sendJson(
      res,
      400,
      graphError(
        100,
        `(#100) metric[0] must be one of the following values: ${[...MEDIA_METRICS].join(', ')}`,
      ),
    );
    return true;
  }
  // Media insights document two breakdowns, `action_type` for
  // profile_activity and `story_navigation_action_type` for navigation, and
  // this endpoint serves neither metric: so any breakdown here is one Meta
  // does not document for it (follow_type is account-level only), and is
  // refused rather than ignored (§3; capability reference,
  // instagram/media-insights-breakdowns).
  const breakdown = url.searchParams.get('breakdown');
  if (breakdown !== null) {
    sendJson(
      res,
      400,
      graphError(
        100,
        `(#100) The breakdown ${breakdown} is not supported for metric ${metrics.join(',')} on media insights`,
      ),
    );
    return true;
  }

  const object = social.object('instagram', id);
  const views = social.cumulative(object, 'views');
  const likes = social.cumulative(object, 'likes');
  const comments = social.cumulative(object, 'comments');
  const saved = social.cumulative(object, 'saves');
  const shares = social.cumulative(object, 'shares');
  const watchedMs = social.watchSeconds(object) * MS;
  const reach = mediaReach(social, instagram, object);
  const value: Record<string, number> = {
    views,
    reach,
    total_interactions: likes + comments + saved + shares,
    likes,
    comments,
    saved,
    shares,
    ig_reels_video_view_total_time: watchedMs,
    // Not total ÷ views: on a live Reel (owner, 2026-09-29) Meta's average
    // was total ÷ 121 while views were 221. Which count it divides by
    // (accounts reached, or first plays) is not yet confirmed; the sandbox
    // uses reach, a count below views, so nothing here can pass by assuming
    // the average is derivable from views.
    ig_reels_avg_watch_time: reach > 0 ? Math.round(watchedMs / reach) : 0,
    reels_skip_rate: views > 0 ? SKIP_PERCENT : 0,
  };

  sendJson(res, 200, {
    data: metrics.map((name) => ({
      name,
      period: 'lifetime',
      values: [{ value: value[name] }],
      id: `${id}/insights/${name}/lifetime`,
    })),
  });
  return true;
};

const COUNTRIES = ['US', 'IN', 'GB', 'BR', 'DE'];
const CITIES = [
  'Mumbai, Maharashtra',
  'London, England',
  'Los Angeles, California',
];
const AGES = ['18-24', '25-34', '35-44', '45-54'];
const GENDERS = ['F', 'M', 'U'];

/** GET /{ig-user-id}/insights — reach, views, follower_demographics. */
const userInsights: SocialRoute = ({ url, method, req, res, social }) => {
  const path = graphPath(url.pathname);
  const instagram = social.signedIn('instagram');
  if (method !== 'GET' || path !== `/${instagram.id}/insights`) return false;

  if (!metaAuthorize(url, req, res, social, INSIGHTS_SCOPE)) return true;
  const page = social.signedIn('facebook');
  if (!meterInstagramCall(social, res, instagram.id, page.id)) return true;

  const q = url.searchParams;
  const metrics = (q.get('metric') ?? '').split(',').filter(Boolean);
  const breakdown = q.get('breakdown');

  if (metrics.includes('follower_demographics')) {
    if (!q.get('timeframe') || !breakdown) {
      sendJson(
        res,
        400,
        graphError(
          100,
          '(#100) For the metric follower_demographics, timeframe and breakdown are required',
        ),
      );
      return true;
    }
    const keys =
      breakdown === 'country'
        ? COUNTRIES
        : breakdown === 'city'
          ? CITIES
          : breakdown === 'age'
            ? AGES
            : GENDERS;
    const followers = social.followers(instagram);
    let left = followers;
    const results = keys.map((key, index) => {
      const share =
        index === keys.length - 1 ? left : Math.floor(followers / (index + 2));
      left -= share;
      return { dimension_values: [key], value: Math.max(0, share) };
    });
    sendJson(res, 200, {
      data: [
        {
          name: 'follower_demographics',
          period: 'lifetime',
          total_value: {
            breakdowns: [{ dimension_keys: [breakdown], results }],
          },
          id: `${instagram.id}/insights/follower_demographics/lifetime`,
        },
      ],
    });
    return true;
  }

  const since = Number(q.get('since'));
  const until = Number(q.get('until'));
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) {
    sendJson(
      res,
      400,
      graphError(100, '(#100) The parameter since must be before until'),
    );
    return true;
  }
  if (until - since > MAX_WINDOW_S) {
    sendJson(
      res,
      400,
      graphError(
        100,
        '(#100) There cannot be more than 30 days (2592000 s) between since and until',
      ),
    );
    return true;
  }

  const fromMs = since * 1000;
  const toMs = Math.min(until * 1000, social.now());
  const reach = accountReach(social, instagram, fromMs, toMs);
  const views = viewsBetween(social, instagram, fromMs, toMs);

  sendJson(res, 200, {
    data: metrics.map((name) => {
      const value =
        name === 'reach' ? reach.total : name === 'views' ? views : 0;
      return {
        name,
        period: 'day',
        total_value: {
          value,
          ...(name === 'reach' && breakdown === 'follow_type'
            ? {
                breakdowns: [
                  {
                    dimension_keys: ['follow_type'],
                    results: [
                      {
                        dimension_values: ['FOLLOWER'],
                        value: reach.followers,
                      },
                      {
                        dimension_values: ['NON_FOLLOWER'],
                        value: reach.nonFollowers,
                      },
                    ],
                  },
                ],
              }
            : {}),
        },
        id: `${instagram.id}/insights/${name}/day`,
      };
    }),
  });
  return true;
};

export const metaInsightsRoutes: readonly SocialRoute[] = [
  userInsights,
  mediaInsights,
  nodes,
];
