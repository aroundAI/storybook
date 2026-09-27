import { sendJson } from '../../../http';
import { nextDate, pacificMidnight } from '../../pacific';
import type { SocialRoute } from '../../server';
import { drawWeights, percentages, splitInteger } from '../../split';
import type { SocialObject, SocialState } from '../../state';
import { ANALYTICS_SCOPES, SCOPE, authorize, googleError } from './errors';

/**
 * YouTube Analytics API v2, `reports.query`
 * (https://developers.google.com/youtube/analytics/reference/reports/query).
 *
 * Built from each video's growth rather than invented per call: a window's
 * figure is the cumulative at its end minus the cumulative at its start, so
 * a day's rows sum to the window's total, a breakdown's parts sum to the
 * whole, and asking twice gives the same answer. Behaviour the capability
 * reference documents is reproduced: the 48–72 hour processing delay (in
 * simulated time), revenue only with yt-analytics-monetary.readonly,
 * elapsedVideoTimeRatio only for one video, averageViewPercentage refused
 * beside liveOrOnDemand, and no `rows` at all when there is no data.
 */

const HOUR_MS = 3_600_000;

/** Every metric served; the fidelity test holds this to the field index. */
export const ANALYTICS_METRICS = [
  'views',
  'engagedViews',
  'likes',
  'dislikes',
  'comments',
  'shares',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'viewerPercentage',
  'cardClickRate',
  'adImpressions',
  'estimatedRevenue',
  'estimatedAdRevenue',
  'estimatedRedPartnerRevenue',
  'audienceWatchRatio',
  'relativeRetentionPerformance',
] as const;

const MONETARY = new Set([
  'estimatedRevenue',
  'estimatedAdRevenue',
  'estimatedRedPartnerRevenue',
  'adImpressions',
]);

/** Retention metrics: only on elapsedVideoTimeRatio. */
const RETENTION = new Set([
  'audienceWatchRatio',
  'relativeRetentionPerformance',
]);

/** Every dimension served, with its documented values (dimensions reference). */
export const ANALYTICS_DIMENSIONS = {
  day: null,
  elapsedVideoTimeRatio: null,
  ageGroup: [
    'age13-17',
    'age18-24',
    'age25-34',
    'age35-44',
    'age45-54',
    'age55-64',
    'age65-',
  ],
  gender: ['female', 'male', 'user_specified'],
  insightTrafficSourceType: [
    'ADVERTISING',
    'ANNOTATION',
    'CAMPAIGN_CARD',
    'END_SCREEN',
    'EXT_URL',
    'HASHTAGS',
    'LIVE_REDIRECT',
    'NO_LINK_EMBEDDED',
    'NO_LINK_OTHER',
    'NOTIFICATION',
    'PLAYLIST',
    'PRODUCT_PAGE',
    'PROMOTED',
    'RELATED_VIDEO',
    'SHORTS',
    'SOUND_PAGE',
    'SUBSCRIBER',
    'YT_CHANNEL',
    'YT_OTHER_PAGE',
    'YT_SEARCH',
    'VIDEO_REMIXES',
    'WATCH_WITH',
  ],
  country: [
    'US',
    'GB',
    'IN',
    'CA',
    'AU',
    'DE',
    'BR',
    'PH',
    'NG',
    'MX',
    'FR',
    'ID',
    'ZA',
    'KE',
    'IE',
    'NZ',
    'NL',
    'SE',
    'PK',
    'ES',
    'IT',
    'JP',
    'PL',
    'MY',
    'SG',
  ],
  city: [
    'London',
    'New York',
    'Los Angeles',
    'Toronto',
    'Sydney',
    'Manchester',
    'Chicago',
    'Mumbai',
    'Lagos',
    'Melbourne',
    'Houston',
    'Dublin',
    'Birmingham',
    'Delhi',
    'Vancouver',
    'Nairobi',
    'Auckland',
    'Glasgow',
    'Seattle',
    'Leeds',
    'Atlanta',
    'Bristol',
    'Calgary',
    'Johannesburg',
    'Brisbane',
  ],
  deviceType: [
    'MOBILE',
    'DESKTOP',
    'TV',
    'TABLET',
    'GAME_CONSOLE',
    'AUTOMOTIVE',
    'WEARABLE',
    'UNKNOWN_PLATFORM',
  ],
  operatingSystem: [
    'ANDROID',
    'IOS',
    'WINDOWS',
    'MACINTOSH',
    'SMART_TV',
    'LINUX',
    'CHROMECAST',
    'PLAYSTATION',
    'XBOX',
    'WEBOS',
    'TIZEN',
    'OTHER',
  ],
  subscribedStatus: ['UNSUBSCRIBED', 'SUBSCRIBED'],
  creatorContentType: [
    'VIDEO_ON_DEMAND',
    'SHORTS',
    'LIVE_STREAM',
    'STORY',
    'UNSPECIFIED',
  ],
  liveOrOnDemand: ['ON_DEMAND', 'LIVE'],
} as const;

type Dimension = keyof typeof ANALYTICS_DIMENSIONS;

function isDimension(name: string): name is Dimension {
  return Object.hasOwn(ANALYTICS_DIMENSIONS, name);
}

function badRequest(message: string) {
  return googleError(400, message, 'badRequest', 'INVALID_ARGUMENT');
}

const FORBIDDEN = googleError(
  403,
  'Forbidden',
  'forbidden',
  'PERMISSION_DENIED',
);

function round(value: number, places: number) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Per-video constants, stable for a run. */
function traits(social: SocialState, object: SocialObject) {
  const rng = social.rngFor(`yt-traits:${object.id}`);
  return {
    delayMs: (48 + rng.int(0, 24)) * HOUR_MS,
    engaged: 0.58 + rng.next() * 0.3,
    rpm: 0.9 + rng.next() * 3.6,
    adRate: 0.45 + rng.next() * 0.3,
    cardClickRate: round(0.2 + rng.next() * 1.4, 4),
  };
}

/** A count metric's cumulative for one video, as reported at `at`. */
function cumulative(
  social: SocialState,
  object: SocialObject,
  metric: string,
  at: number,
) {
  const { delayMs, engaged, rpm, adRate } = traits(social, object);
  const c = (m: Parameters<SocialState['cumulative']>[1]) =>
    social.cumulative(object, m, Math.min(at, social.now()), delayMs);

  switch (metric) {
    case 'views':
    case 'likes':
    case 'comments':
    case 'shares':
      return c(metric);
    case 'dislikes':
      return Math.floor(c('likes') * 0.035);
    case 'engagedViews':
      return Math.floor(c('views') * engaged);
    case 'subscribersGained':
      return c('follows');
    case 'subscribersLost':
      return Math.floor(c('follows') * 0.11);
    case 'estimatedMinutesWatched':
      return Math.floor(
        social.watchSeconds(object, Math.min(at, social.now()), delayMs) / 60,
      );
    case 'watchSeconds':
      return social.watchSeconds(object, Math.min(at, social.now()), delayMs);
    case 'adImpressions':
      return Math.floor(c('views') * adRate);
    case 'estimatedRevenue':
      return (c('views') / 1000) * rpm;
    case 'estimatedAdRevenue':
      return (c('views') / 1000) * rpm * 0.92;
    case 'estimatedRedPartnerRevenue':
      return (c('views') / 1000) * rpm * 0.08;
    default:
      return 0;
  }
}

interface Window {
  from: number;
  to: number;
}

/** Sums of the count metrics over a window, across videos. */
function totals(social: SocialState, objects: SocialObject[], window: Window) {
  const names = [
    'views',
    'engagedViews',
    'likes',
    'dislikes',
    'comments',
    'shares',
    'estimatedMinutesWatched',
    'watchSeconds',
    'subscribersGained',
    'subscribersLost',
    'adImpressions',
    'estimatedRevenue',
    'estimatedAdRevenue',
    'estimatedRedPartnerRevenue',
  ];
  const sum: Record<string, number> = Object.fromEntries(
    names.map((n) => [n, 0]),
  );
  let durationViews = 0;
  let clickRate = 0;

  for (const object of objects) {
    for (const name of names) {
      sum[name]! +=
        cumulative(social, object, name, window.to) -
        cumulative(social, object, name, window.from);
    }
    const views =
      cumulative(social, object, 'views', window.to) -
      cumulative(social, object, 'views', window.from);
    durationViews += views * object.durationSeconds;
    clickRate += traits(social, object).cardClickRate * views;
  }

  const views = sum.views!;
  return {
    ...sum,
    averageViewDuration: views > 0 ? Math.round(sum.watchSeconds! / views) : 0,
    averageViewPercentage:
      durationViews > 0
        ? round((sum.watchSeconds! / durationViews) * 100, 2)
        : 0,
    cardClickRate: views > 0 ? round(clickRate / views, 4) : 0,
  } as Record<string, number>;
}

function metricValue(name: string, t: Record<string, number>) {
  const v = t[name] ?? 0;
  if (name.startsWith('estimated') && name.endsWith('Revenue'))
    return round(v, 3);
  return v;
}

const INTEGER_METRICS = new Set([
  'views',
  'engagedViews',
  'likes',
  'dislikes',
  'comments',
  'shares',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'subscribersGained',
  'subscribersLost',
  'adImpressions',
]);

/**
 * The Pacific days in [startDate, endDate] that have data: on or after the
 * first publish, and already processed (the 48–72 hour delay).
 */
function processedDays(
  social: SocialState,
  objects: SocialObject[],
  startDate: string,
  endDate: string,
) {
  const latest = Math.max(
    ...objects.map(
      (o) =>
        social.now() - traits(social, o).delayMs / Math.max(social.speed, 1e-9),
    ),
  );
  const firstPublished = Math.min(...objects.map((o) => o.publishedMs));
  const days: string[] = [];
  for (let date = startDate; date <= endDate; date = nextDate(date)) {
    if (pacificMidnight(nextDate(date)) <= firstPublished) continue;
    if (pacificMidnight(date) >= latest) break;
    days.push(date);
  }
  return days;
}

/** The retention curve: its mean over the video is the share watched. */
function retentionPoints(social: SocialState, object: SocialObject) {
  const completion = object.profile.ratios.completion;
  // Solve (1 - e^-k) / k = completion for k by bisection.
  let lo = 1e-6;
  let hi = 60;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if ((1 - Math.exp(-k)) / k > completion) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  const rng = social.rngFor(`yt-retention:${object.id}`);
  return Array.from({ length: 100 }, (_, i) => {
    const x = (i + 1) / 100;
    const ratio = Math.exp(-k * x) * (1 + (rng.next() - 0.5) * 0.02);
    return [x, round(ratio, 4), round(0.3 + rng.next() * 0.4, 4)] as const;
  });
}

function header(name: string, columnType: 'DIMENSION' | 'METRIC') {
  return {
    name,
    columnType,
    dataType:
      columnType === 'DIMENSION'
        ? name === 'elapsedVideoTimeRatio'
          ? 'FLOAT'
          : 'STRING'
        : INTEGER_METRICS.has(name)
          ? 'INTEGER'
          : 'FLOAT',
  };
}

function dateOk(value: string | null) {
  return (
    value !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** GET /v2/reports */
const reportsQuery: SocialRoute = ({
  url,
  method,
  req,
  res,
  social,
  about,
}) => {
  if (method !== 'GET' || url.pathname !== '/v2/reports') return false;

  const token = authorize(req, res, social, ANALYTICS_SCOPES);
  if (!token) return true;
  const q = url.searchParams;

  const ids = q.get('ids') ?? '';
  if (ids !== 'channel==MINE' && ids !== `channel==${token.accountId}`) {
    sendJson(res, 403, FORBIDDEN);
    return true;
  }
  if (!dateOk(q.get('startDate')) || !dateOk(q.get('endDate'))) {
    sendJson(
      res,
      400,
      badRequest(
        'Required parameters startDate and endDate must be dates in the format YYYY-MM-DD.',
      ),
    );
    return true;
  }

  const metrics = (q.get('metrics') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const dimensions = (q.get('dimensions') ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);

  for (const metric of metrics) {
    if (!(ANALYTICS_METRICS as readonly string[]).includes(metric)) {
      sendJson(
        res,
        400,
        badRequest(
          `Unknown identifier (${metric}) given in field parameters.metrics.`,
        ),
      );
      return true;
    }
  }
  for (const dimension of dimensions) {
    if (!isDimension(dimension)) {
      sendJson(
        res,
        400,
        badRequest(
          `Unknown identifier (${dimension}) given in field parameters.dimensions.`,
        ),
      );
      return true;
    }
  }
  if (metrics.length === 0 || dimensions.length > 1) {
    sendJson(res, 400, badRequest('The query is not supported.'));
    return true;
  }
  if (
    metrics.some((m) => MONETARY.has(m)) &&
    !token.scopes.includes(SCOPE.monetary)
  ) {
    sendJson(res, 403, FORBIDDEN);
    return true;
  }

  const videoFilter = /(?:^|;)video==([^;]+)/.exec(q.get('filters') ?? '')?.[1];
  const dimension = dimensions[0] as Dimension | undefined;
  const retentionAsked = metrics.some((m) => RETENTION.has(m));

  if (
    (dimension === 'elapsedVideoTimeRatio') !== retentionAsked ||
    (dimension === 'elapsedVideoTimeRatio' && !videoFilter) ||
    (dimension === 'liveOrOnDemand' &&
      metrics.includes('averageViewPercentage'))
  ) {
    sendJson(res, 400, badRequest('The query is not supported.'));
    return true;
  }

  let objects: SocialObject[];
  if (videoFilter) {
    about(videoFilter);
    const object = social.object('youtube', videoFilter);
    // A seeded publish is adopted by the first channel that asks about it.
    if (object.accountId === null) object.accountId = token.accountId;
    if (object.accountId !== token.accountId) {
      sendJson(res, 403, FORBIDDEN);
      return true;
    }
    objects = [object];
  } else {
    objects = social
      .listObjects('youtube')
      .filter((o) => o.accountId === token.accountId);
  }

  const startDate = q.get('startDate')!;
  const endDate = q.get('endDate')!;
  // YouTube's days are Pacific days.
  const window = {
    from: pacificMidnight(startDate),
    to: pacificMidnight(nextDate(endDate)),
  };
  const columnHeaders = [
    ...(dimension ? [header(dimension, 'DIMENSION')] : []),
    ...metrics.map((m) => header(m, 'METRIC')),
  ];

  let rows: Array<Array<string | number>> = [];

  if (
    objects.length > 0 &&
    processedDays(social, objects, startDate, endDate).length > 0
  ) {
    if (!dimension) {
      const t = totals(social, objects, window);
      rows = [metrics.map((m) => metricValue(m, t))];
    } else if (dimension === 'day') {
      rows = processedDays(social, objects, startDate, endDate).map((date) => {
        const t = totals(social, objects, {
          from: pacificMidnight(date),
          to: pacificMidnight(nextDate(date)),
        });
        return [date, ...metrics.map((m) => metricValue(m, t))];
      });
    } else if (dimension === 'elapsedVideoTimeRatio') {
      rows = retentionPoints(social, objects[0]!).map(
        ([x, watch, relative]) => [
          x,
          ...metrics.map((m) =>
            m === 'audienceWatchRatio' ? watch : relative,
          ),
        ],
      );
    } else {
      rows = breakdown(social, objects, window, dimension, metrics);
    }
  }

  const sort = q.get('sort');
  if (sort) {
    const descending = sort.startsWith('-');
    const column = columnHeaders.findIndex(
      (h) => h.name === sort.replace(/^-/, ''),
    );
    if (column >= 0) {
      rows.sort((a, b) => {
        const x = a[column]!;
        const y = b[column]!;
        const order =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
        return descending ? -order : order;
      });
    }
  }
  const maxResults = Number(q.get('maxResults') ?? '');
  if (Number.isInteger(maxResults) && maxResults > 0)
    rows = rows.slice(0, maxResults);

  sendJson(res, 200, {
    kind: 'youtubeAnalytics#resultTable',
    columnHeaders,
    // "If no data is available for the given query, the rows element will be omitted."
    ...(rows.length > 0 ? { rows } : {}),
  });
  return true;
};

/** Rows for a categorical dimension: each video's totals split across its values. */
function breakdown(
  social: SocialState,
  objects: SocialObject[],
  window: Window,
  dimension: Exclude<Dimension, 'day' | 'elapsedVideoTimeRatio'>,
  metrics: string[],
) {
  const values = ANALYTICS_DIMENSIONS[dimension];
  const counts = new Map<string, Record<string, number>>(
    values.map((v) => [v, {}]),
  );
  const weightTotals = new Map<string, number>(values.map((v) => [v, 0]));

  for (const object of objects) {
    const kind = String(
      object.details?.creatorContentType ?? 'VIDEO_ON_DEMAND',
    );
    const weights =
      dimension === 'creatorContentType'
        ? values.map((v) => (v === kind ? 1 : 0))
        : dimension === 'liveOrOnDemand'
          ? values.map((v) => (v === 'ON_DEMAND' ? 1 : 0))
          : drawWeights(
              social.rngFor(`yt-weights:${dimension}:${object.id}`),
              values.length,
            );
    const t = totals(social, [object], window);

    for (const name of Object.keys(t)) {
      const parts =
        INTEGER_METRICS.has(name) || name === 'watchSeconds'
          ? splitInteger(Math.round(t[name]!), weights)
          : weights.map(
              (w) => (t[name]! * w) / weights.reduce((a, b) => a + b, 0),
            );
      values.forEach((value, i) => {
        const row = counts.get(value)!;
        row[name] = (row[name] ?? 0) + parts[i]!;
      });
    }
    values.forEach((value, i) =>
      weightTotals.set(
        value,
        weightTotals.get(value)! + weights[i]! * Math.max(t.views!, 1),
      ),
    );
  }

  const shares = percentages(values.map((v) => weightTotals.get(v)!));
  const overall = totals(social, objects, window);

  return (
    values
      .map((value, i) => {
        const row = counts.get(value)!;
        const views = row.views ?? 0;
        const withAverages: Record<string, number> = {
          ...row,
          averageViewDuration:
            views > 0 ? Math.round((row.watchSeconds ?? 0) / views) : 0,
          // A share of the length watched does not split: each value carries the videos'.
          averageViewPercentage: overall.averageViewPercentage!,
          cardClickRate: overall.cardClickRate!,
          viewerPercentage: shares[i]!,
        };
        return {
          value,
          views,
          cells: metrics.map((m) => metricValue(m, withAverages)),
        };
      })
      // A value nobody watched from is not a row, as in the real reports.
      .filter(({ views, cells }) => views > 0 || cells.some((c) => c !== 0))
      .map(({ value, cells }) => [value, ...cells])
  );
}

export const youtubeAnalyticsRoutes = [reportsQuery];
