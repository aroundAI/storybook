import { sendJson } from '../../../http';
import type { SocialRoute } from '../../server';
import type { SocialObject, SocialState } from '../../state';
import { graphError, graphPath, metaAuthorize } from './errors';
import { reachablePool, uniqueReach } from './insights';

const DAY_MS = 86_400_000;

/**
 * The Facebook Page video reads the app makes (FILM-1720,
 * `facebook-insights.ts` in @kit/content-analytics):
 *
 * - `GET /{video-id}?fields=post_id,comments.limit(0).summary(true)` —
 *   `facebook/video-fields`;
 * - `GET /{video-id}/video_insights?metric=…&period=lifetime` —
 *   `facebook/video-insights`;
 * - `GET /{post-id}?fields=shares` — `facebook/post-fields`;
 * - `GET /{post-id}/insights?metric=…&period=lifetime` —
 *   `facebook/post-insights`;
 * - `GET /{page-id}?fields=followers_count` — `facebook/page-fields`;
 * - `GET /{page-id}/insights?metric=page_total_media_view_unique&period=…`
 *   — `facebook/page-insights`, one value per day in `since`–`until`.
 *
 * A post id is `{page-id}_{video-id}`, as Meta's are. The figures follow the
 * video's growth curve and keep Meta's documented orderings: a first play
 * is counted before a 3-second view, a 3-second view before a 15-second or a
 * complete one; organic plus paid is the 3-second total, and so is autoplay
 * plus click-to-play; the post's media views (played or displayed) exceed
 * its plays; unique viewers saturate towards the Page's reachable pool, and
 * a longer window ending the same day reaches at least as many. A video's
 * 3-second views by age and gender, and by country, add up to its 3-second
 * total.
 *
 * The metrics Graph v25.0 retired for every version since v26.0 answer
 * `(#100)`, as Meta says requesting one does.
 */

const INSIGHTS_SCOPE = ['read_insights'];
const PAGE_READ_SCOPE = ['pages_read_engagement'];

const SHARE = {
  replays: 0.17,
  threeSecond: 0.6,
  organic: 0.82,
  autoplayed: 0.68,
  fifteenSecond: 0.33,
  displayedPerPlay: 1.35,
  love: 0.2,
} as const;

/** Intervals in `total_video_retention_graph`: "40 equal intervals". */
const RETENTION_INTERVALS = 40;

const VIDEO_METRICS = new Set([
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
  'blue_reels_play_count',
  'fb_reels_replay_count',
  'post_video_view_time',
  'post_video_followers',
  'post_video_likes_by_reaction_type',
  'total_video_views_by_age_bucket_and_gender',
  'total_video_views_by_country_id',
]);

/**
 * The keys Meta's breakdowns use: `{F|M|U}.{age bucket}` and a two-letter
 * country. Each video's 3-second views are shared out over them, the larger
 * shares first, the last taking the remainder so they add up.
 */
const AGE_GENDER_KEYS = ['18-24', '25-34', '35-44', '45-54', '55-64'].flatMap(
  (age) => ['F', 'M', 'U'].map((gender) => `${gender}.${age}`),
);
export const FACEBOOK_COUNTRIES = ['US', 'GB', 'IN', 'CA', 'AU'];

function shareOut(total: number, keys: readonly string[]) {
  let left = total;
  return Object.fromEntries(
    keys.map((key, index) => {
      const share = index === keys.length - 1 ? left : Math.floor(left / 2);
      left -= share;
      return [key, share];
    }),
  );
}

/** The periods `page_total_media_view_unique` takes, in days. */
const PAGE_PERIODS: Readonly<Record<string, number>> = {
  day: 1,
  week: 7,
  days_28: 28,
};

const POST_METRICS = new Set([
  'post_media_view',
  'post_total_media_view_unique',
]);

function video(social: SocialState, id: string): SocialObject {
  return social.object('facebook', id);
}

function threeSecond(social: SocialState, object: SocialObject) {
  return Math.floor(social.cumulative(object, 'views') * SHARE.threeSecond);
}

function reactions(social: SocialState, object: SocialObject) {
  const likes = social.cumulative(object, 'likes');
  const love = Math.floor(likes * SHARE.love);
  return { like: likes - love, love };
}

/** A share of plays still going, falling from 1 to near the completion ratio. */
function retentionGraph(object: SocialObject) {
  const floor = object.profile.ratios.completion;
  return Object.fromEntries(
    Array.from({ length: RETENTION_INTERVALS + 1 }, (_, interval) => [
      String(interval),
      Number(
        (
          1 -
          (1 - floor) * Math.pow(interval / RETENTION_INTERVALS, 0.6)
        ).toFixed(4),
      ),
    ]),
  );
}

function videoMetric(
  social: SocialState,
  object: SocialObject,
  name: string,
): number | Record<string, number> {
  const plays = social.cumulative(object, 'views');
  const replays = Math.floor(plays * SHARE.replays);
  const views3s = threeSecond(social, object);
  const organic = Math.floor(views3s * SHARE.organic);
  const autoplayed = Math.floor(views3s * SHARE.autoplayed);
  const watchedMs = social.watchSeconds(object) * 1000;
  const replayMs =
    Math.floor(
      replays * object.durationSeconds * object.profile.ratios.completion,
    ) * 1000;

  switch (name) {
    case 'total_video_views':
      return views3s;
    case 'total_video_views_organic':
      return organic;
    case 'total_video_views_paid':
      return views3s - organic;
    case 'total_video_views_autoplayed':
      return autoplayed;
    case 'total_video_views_clicked_to_play':
      return views3s - autoplayed;
    case 'total_video_15s_views':
      return Math.floor(views3s * SHARE.fifteenSecond);
    case 'total_video_complete_views':
      return Math.floor(views3s * object.profile.ratios.completion);
    case 'total_video_view_total_time':
      return watchedMs;
    case 'total_video_retention_graph':
      return retentionGraph(object);
    case 'total_video_reactions_by_type_total':
    case 'post_video_likes_by_reaction_type':
      return reactions(social, object);
    case 'blue_reels_play_count':
      return plays;
    case 'fb_reels_replay_count':
      return replays;
    case 'post_video_view_time':
      return watchedMs + replayMs;
    case 'post_video_followers':
      return social.cumulative(object, 'follows');
    case 'total_video_views_by_age_bucket_and_gender':
      return shareOut(views3s, AGE_GENDER_KEYS);
    case 'total_video_views_by_country_id':
      return shareOut(views3s, FACEBOOK_COUNTRIES);
    default:
      return 0;
  }
}

function metricsOf(url: URL) {
  return (url.searchParams.get('metric') ?? '').split(',').filter(Boolean);
}

function refuseMetric(
  res: Parameters<SocialRoute>[0]['res'],
  known: ReadonlySet<string>,
) {
  sendJson(
    res,
    400,
    graphError(
      100,
      `(#100) metric[0] must be one of the following values: ${[...known].join(', ')}`,
    ),
  );
}

/** GET /{video-id}?fields=post_id,comments… — the Page video node. */
const videoNode: SocialRoute = ({ url, method, req, res, social, about }) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)$/.exec(path)?.[1];
  const fields = (url.searchParams.get('fields') ?? '').split(',');
  if (method !== 'GET' || !id || !fields.includes('post_id')) return false;

  const page = social.signedIn('facebook');
  if (id === page.id) return false;
  if (!metaAuthorize(url, req, res, social, PAGE_READ_SCOPE)) return true;
  about(id);

  const object = video(social, id);
  sendJson(res, 200, {
    post_id: `${page.id}_${id}`,
    ...(fields.some((field) => field.startsWith('comments')) && {
      comments: {
        data: [],
        summary: { total_count: social.cumulative(object, 'comments') },
      },
    }),
    id,
  });
  return true;
};

/** GET /{video-id}/video_insights?metric=…&period=lifetime */
const videoInsights: SocialRoute = ({
  url,
  method,
  req,
  res,
  social,
  about,
}) => {
  const path = graphPath(url.pathname);
  const id = path && /^\/(\d+)\/video_insights$/.exec(path)?.[1];
  if (method !== 'GET' || !id) return false;
  if (!metaAuthorize(url, req, res, social, INSIGHTS_SCOPE)) return true;
  about(id);

  const metrics = metricsOf(url);
  if (metrics.length === 0 || metrics.some((m) => !VIDEO_METRICS.has(m))) {
    refuseMetric(res, VIDEO_METRICS);
    return true;
  }

  const object = video(social, id);
  sendJson(res, 200, {
    data: metrics.map((name) => ({
      name,
      period: 'lifetime',
      values: [{ value: videoMetric(social, object, name) }],
      id: `${id}/video_insights/${name}/lifetime`,
    })),
  });
  return true;
};

/** `{page-id}_{video-id}`, and the video id inside it. */
function postVideoId(
  social: SocialState,
  path: string | null | undefined,
  tail: string,
) {
  const match = path && new RegExp(`^/(\\d+)_(\\d+)${tail}$`).exec(path);
  return match && match[1] === social.signedIn('facebook').id
    ? match[2]!
    : null;
}

/** GET /{post-id}?fields=shares — absent on a post nobody has shared. */
const postNode: SocialRoute = ({ url, method, req, res, social }) => {
  const videoId = postVideoId(social, graphPath(url.pathname), '');
  if (method !== 'GET' || !videoId) return false;
  if (!metaAuthorize(url, req, res, social, PAGE_READ_SCOPE)) return true;

  const shares = social.cumulative(video(social, videoId), 'shares');
  sendJson(res, 200, {
    ...(shares > 0 && { shares: { count: shares } }),
    id: `${social.signedIn('facebook').id}_${videoId}`,
  });
  return true;
};

/** GET /{post-id}/insights?metric=post_media_view,post_total_media_view_unique */
const postInsights: SocialRoute = ({ url, method, req, res, social }) => {
  const videoId = postVideoId(social, graphPath(url.pathname), '/insights');
  if (method !== 'GET' || !videoId) return false;
  if (!metaAuthorize(url, req, res, social, INSIGHTS_SCOPE)) return true;

  const metrics = metricsOf(url);
  if (metrics.length === 0 || metrics.some((m) => !POST_METRICS.has(m))) {
    refuseMetric(res, POST_METRICS);
    return true;
  }

  const page = social.signedIn('facebook');
  const object = video(social, videoId);
  const mediaViews = Math.floor(
    social.cumulative(object, 'views') * SHARE.displayedPerPlay,
  );
  const value: Record<string, number> = {
    post_media_view: mediaViews,
    post_total_media_view_unique: uniqueReach(
      mediaViews,
      reachablePool(social.followers(page)),
    ),
  };
  const postId = `${page.id}_${videoId}`;

  sendJson(res, 200, {
    data: metrics.map((name) => ({
      name,
      period: 'lifetime',
      values: [{ value: value[name] }],
      id: `${postId}/insights/${name}/lifetime`,
    })),
  });
  return true;
};

/** GET /{page-id}?fields=followers_count */
const pageNode: SocialRoute = ({ url, method, req, res, social }) => {
  const page = social.signedIn('facebook');
  const fields = (url.searchParams.get('fields') ?? '').split(',');
  if (
    method !== 'GET' ||
    graphPath(url.pathname) !== `/${page.id}` ||
    !fields.includes('followers_count')
  ) {
    return false;
  }
  if (!metaAuthorize(url, req, res, social, PAGE_READ_SCOPE)) return true;

  sendJson(res, 200, { followers_count: social.followers(page), id: page.id });
  return true;
};

/** 3-second-or-more plays across the Page's videos in [fromMs, toMs). */
function pagePlaysBetween(social: SocialState, fromMs: number, toMs: number) {
  const page = social.signedIn('facebook');
  return social
    .listObjects('facebook')
    .filter((o) => o.accountId === page.id || o.accountId === null)
    .reduce(
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

/**
 * GET /{page-id}/insights?metric=page_total_media_view_unique&period=…
 *
 * One value per day from `since` to `until`, each the distinct viewers of
 * the period ending at that value's `end_time`. Meta's day ends at midnight
 * Pacific; the sandbox ends it at UTC midnight, which is all the app reads.
 */
const pageInsights: SocialRoute = ({ url, method, req, res, social }) => {
  const page = social.signedIn('facebook');
  if (method !== 'GET' || graphPath(url.pathname) !== `/${page.id}/insights`) {
    return false;
  }
  if (!metaAuthorize(url, req, res, social, INSIGHTS_SCOPE)) return true;

  const metrics = metricsOf(url);
  const known = new Set(['page_total_media_view_unique']);
  if (metrics.length === 0 || metrics.some((m) => !known.has(m))) {
    refuseMetric(res, known);
    return true;
  }

  const period = url.searchParams.get('period') ?? 'day';
  const days = PAGE_PERIODS[period];
  const since = Number(url.searchParams.get('since')) * 1000;
  const until = Number(url.searchParams.get('until')) * 1000;
  if (!days || !Number.isFinite(since) || !(until > since)) {
    sendJson(
      res,
      400,
      graphError(100, '(#100) period, since and until are required'),
    );
    return true;
  }

  const pool = reachablePool(social.followers(page));
  const values: { value: number; end_time: string }[] = [];
  for (let end = since + DAY_MS; end <= until; end += DAY_MS) {
    const to = Math.min(end, social.now());
    values.push({
      value: uniqueReach(
        pagePlaysBetween(social, end - days * DAY_MS, to),
        pool,
      ),
      end_time: new Date(end).toISOString().replace('.000Z', '+0000'),
    });
  }

  sendJson(res, 200, {
    data: metrics.map((name) => ({
      name,
      period,
      values,
      id: `${page.id}/insights/${name}/${period}`,
    })),
  });
  return true;
};

/** Before the publishing routes: a video node read for `post_id` is ours. */
export const facebookInsightsRoutes: readonly SocialRoute[] = [
  pageNode,
  pageInsights,
  videoNode,
  videoInsights,
  postInsights,
  postNode,
];
