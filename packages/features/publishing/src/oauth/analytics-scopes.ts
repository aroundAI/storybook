import {
  ALL_ANALYTICS_SCOPES_ENABLED,
  type AnalyticsScopeSwitch,
  isScopeWithheld,
} from './analytics-scope-switch';
import { META_OAUTH_CONFIG } from './meta/config';
import { TIKTOK_OAUTH_CONFIG } from './tiktok/config';
import { TWITTER_OAUTH_CONFIG } from './twitter/config';
import { YOUTUBE_OAUTH_CONFIG } from './youtube/config';

/**
 * FILM-1711. Which OAuth scopes each platform's analytics needs, declared
 * beside the configs that request them.
 *
 * It exists because the two drifted apart unnoticed: the TikTok and Instagram
 * analytics providers shipped with a `*ScopeError` for a scope their OAuth
 * config never asked for. `analytics-scope-binding.test.ts` in
 * `@kit/content-analytics` reads this file and fails when a provider calls an
 * endpoint no requirement covers, or one whose scopes the config does not
 * request.
 *
 * Every scope here traces to `docs/platform-capability-reference.md` or to the
 * vendor page in `source` (the binding test checks the first). `review` is a
 * different kind of fact — our own record of a vendor console — and is bound
 * to `docs/vendor-review-status.md` by `analytics-scopes.test.ts`.
 */

export type AnalyticsAuthPlatform =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'twitter';

/**
 * The vendor-side approval a scope needs before a creator we do not own can
 * grant it. While it is anything but `approved` or `not_required`, asking a
 * creator to reconnect achieves nothing, so the prompt must not be shown.
 * The human-readable tracker is `docs/vendor-review-status.md`.
 */
export type VendorReviewStatus =
  | 'not_required'
  | 'required'
  | 'pending'
  | 'approved'
  | 'denied';

export interface AnalyticsScopeRequirement {
  id: string;
  platform: AnalyticsAuthPlatform;
  /** Every one must be granted. */
  scopes: readonly string[];
  /**
   * How a call to this surface looks in provider source. The binding test
   * matches these against `content-analytics/src/providers`.
   */
  endpoints: readonly RegExp[];
  /**
   * Vendor metric names that need these scopes even though the endpoint they
   * travel on does not. YouTube revenue is the case: same `reports.query`,
   * different scope.
   */
  metrics?: readonly string[];
  /** What the creator gains by granting it. Shown in the reconnect prompt. */
  gains: string;
  /** `implemented`, or the spec that will build the provider. */
  provider: 'implemented' | `FILM-${number}`;
  review: VendorReviewStatus;
  /**
   * Set when holding the scope is not enough because the creator's account
   * must also be of a certain kind. We cannot resolve this; they can.
   */
  accountGate?: { requirement: string; resolution: string };
  source: string;
}

const REFERENCE = 'docs/platform-capability-reference.md';

export const ANALYTICS_SCOPE_REQUIREMENTS: readonly AnalyticsScopeRequirement[] =
  [
    {
      id: 'youtube.analytics',
      platform: 'youtube',
      scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
      endpoints: [
        /\byoutubeAnalytics\.reports\.query\(/,
        /\breporting\.(?:reportTypes|jobs|media)\.[\w.]+\(/,
      ],
      gains: 'Views, watch time, retention, audience and traffic sources',
      provider: 'implemented',
      review: 'approved',
      source:
        'https://developers.google.com/youtube/analytics/reference/reports/query',
    },
    {
      id: 'youtube.revenue',
      platform: 'youtube',
      scopes: [
        'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
      ],
      endpoints: [],
      metrics: [
        'estimatedRevenue',
        'estimatedAdRevenue',
        'estimatedRedPartnerRevenue',
      ],
      gains: 'Estimated revenue, split into ads and YouTube Premium',
      provider: 'implemented',
      review: 'approved',
      accountGate: {
        requirement: 'The channel is in the YouTube Partner Program',
        resolution:
          'YouTube only reports revenue for Partner Program channels. Nothing to reconnect: it will start arriving once the channel is accepted.',
      },
      source:
        'https://developers.google.com/youtube/analytics/reference/reports/query',
    },
    {
      id: 'youtube.video-info',
      platform: 'youtube',
      scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      endpoints: [/\byoutube\.videos\.list\(/],
      gains: 'Video titles, thumbnails and durations',
      provider: 'implemented',
      review: 'approved',
      source:
        'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps',
    },
    {
      id: 'tiktok.video-metrics',
      platform: 'tiktok',
      scopes: ['video.list'],
      endpoints: [/\/video\/query\//],
      gains: 'Views, likes, comments and shares for each TikTok video',
      provider: 'implemented',
      review: 'required',
      source: `${REFERENCE}#tiktok`,
    },
    {
      id: 'tiktok.follower-count',
      platform: 'tiktok',
      scopes: ['user.info.stats'],
      endpoints: [
        /\/user\/info\/\?fields=[a-z_,]*\b(?:follower_count|following_count|likes_count|video_count)\b/,
      ],
      gains: 'Your TikTok follower count over time',
      provider: 'implemented',
      review: 'required',
      source:
        'https://developers.tiktok.com/bulletin/user-info-scope-migration',
    },
    {
      id: 'instagram.insights',
      platform: 'instagram',
      // The Facebook Login triple (Graph, called through metaFetch).
      // The Instagram Login path has a different vocabulary and host, and
      // is not the one in use.
      scopes: [
        'instagram_basic',
        'instagram_manage_insights',
        'pages_read_engagement',
      ],
      endpoints: [/\/insights\?/],
      gains: 'Views, reach, saves and shares for each Reel, and your audience',
      provider: 'implemented',
      review: 'required',
      source: `${REFERENCE}#instagram`,
    },
    {
      id: 'instagram.media-and-account-fields',
      platform: 'instagram',
      scopes: ['instagram_basic'],
      endpoints: [/\$\{(?:mediaId|this\.instagramAccountId)\}\?fields=/],
      gains: 'Reel type and follower count',
      provider: 'implemented',
      review: 'approved',
      source: `${REFERENCE}#instagram`,
    },
    // Meta's video_insights reference names pages_manage_engagement +
    // read_insights with the ANALYZE task; an older page names
    // pages_read_engagement. All three, until one live call settles it
    // (FILM-1720; FILM-1725 Check J's call does).
    {
      id: 'facebook.video-insights',
      platform: 'facebook',
      scopes: [
        'read_insights',
        'pages_manage_engagement',
        'pages_read_engagement',
      ],
      endpoints: [/\/video_insights\?/],
      gains:
        'Plays, 3-second views, watch time and retention for each Facebook video',
      provider: 'implemented',
      review: 'required',
      source: `${REFERENCE}#facebook`,
    },
    {
      id: 'facebook.post-insights',
      platform: 'facebook',
      scopes: ['read_insights', 'pages_read_engagement'],
      endpoints: [/\$\{postId\}\/insights\?/],
      gains: 'How many people viewed each Facebook video’s post',
      provider: 'implemented',
      review: 'required',
      source:
        'https://developers.facebook.com/docs/graph-api/reference/insights/',
    },
    {
      id: 'facebook.video-and-post-fields',
      platform: 'facebook',
      scopes: ['pages_read_engagement'],
      endpoints: [/\$\{(?:videoId|postId)\}\?fields=/],
      gains: 'Comments and shares for each Facebook video',
      provider: 'implemented',
      review: 'required',
      source: `${REFERENCE}#facebook`,
    },
    {
      id: 'facebook.page-fields',
      platform: 'facebook',
      // Meta needs only pages_read_engagement, which every publishing
      // connection holds; read_insights is required too so the count ships
      // dark with the rest of Facebook's analytics (FILM-1720), and this
      // record says "not requested" while the switch is off.
      scopes: ['read_insights', 'pages_read_engagement'],
      endpoints: [/\$\{pageId\}\?fields=/],
      gains: 'Your Facebook Page’s follower count',
      provider: 'implemented',
      review: 'required',
      source: `${REFERENCE}#facebook`,
    },
    {
      id: 'facebook.page-insights',
      platform: 'facebook',
      scopes: ['read_insights', 'pages_read_engagement'],
      endpoints: [/\$\{pageId\}\/insights\?/],
      gains:
        'How many different people saw your Facebook Page’s content over a day, a week and 28 days',
      provider: 'implemented',
      review: 'required',
      source:
        'https://developers.facebook.com/docs/graph-api/reference/insights/',
    },
    {
      id: 'x.post-analytics',
      platform: 'twitter',
      scopes: ['tweet.read', 'users.read'],
      // `${X_API_BASE}/tweets` is how the provider writes the posts lookup:
      // the API version lives in X_API_BASE alone (FILM-1723).
      endpoints: [
        /\/2\/(?:tweets|media\/analytics)\b/,
        /\$\{X_API_BASE\}\/(?:tweets|media\/analytics)\b/,
      ],
      gains: 'Views and playback quartiles for each X video',
      provider: 'implemented',
      review: 'not_required',
      source: `${REFERENCE}#x`,
    },
  ];

/**
 * What each platform's connect route asks for. Instagram and Facebook share
 * one Facebook Login dialog, so they share one list.
 */
export const REQUESTED_SCOPES: Record<
  AnalyticsAuthPlatform,
  readonly string[]
> = {
  youtube: YOUTUBE_OAUTH_CONFIG.scopes,
  tiktok: TIKTOK_OAUTH_CONFIG.scopes,
  instagram: META_OAUTH_CONFIG.scopes,
  facebook: META_OAUTH_CONFIG.scopes,
  twitter: TWITTER_OAUTH_CONFIG.scopes,
};

export function isAnalyticsAuthPlatform(
  platform: string,
): platform is AnalyticsAuthPlatform {
  return platform in REQUESTED_SCOPES;
}

/**
 * The scopes a vendor says it granted, from the raw `scope` string of a token
 * response.
 *
 * Returns `[]` when the vendor sent nothing. It deliberately does not fall
 * back to the scopes we asked for: Google lets a user untick individual
 * scopes, and recording the request as the grant is how a connection comes to
 * claim an authorisation it does not hold.
 */
export function parseGrantedScopes(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];

  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Granted permissions from Meta's `GET /me/permissions`, which lists declined
 * and expired ones beside granted ones.
 * https://developers.facebook.com/docs/graph-api/reference/user/permissions/
 */
export function parseMetaGrantedPermissions(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];

  const data = (body as { data?: unknown }).data;

  if (!Array.isArray(data)) return [];

  return data.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];

    const { permission, status } = entry as {
      permission?: unknown;
      status?: unknown;
    };

    return typeof permission === 'string' && status === 'granted'
      ? [permission]
      : [];
  });
}

/**
 * Why a connection's analytics are or are not reachable.
 *
 * - `scope_missing`: the creator can fix it now, by reconnecting.
 * - `review_pending`: we asked the vendor; nobody can grant it until they
 *   answer, so there is no reconnect prompt.
 * - `not_requested`: our connect request leaves the scope out for now
 *   (`ANALYTICS_SCOPES_ENABLED`), so reconnecting would grant nothing. No
 *   prompt; the owner turns the platform on.
 * - `account_type_gated`: the scope is held and the vendor still refuses,
 *   because of the kind of account it is. Only the creator can change that.
 * - `no_provider`: nothing reads this platform yet.
 * - `unknown`: the connection has no recorded grant at all (it predates the
 *   callback writing one). Not the same as a recorded grant that lacks a
 *   scope, so it is never reported as missing and never blocks a sync.
 */
export type AnalyticsAccessState =
  | 'authorised'
  | 'unknown'
  | 'scope_missing'
  | 'review_pending'
  | 'not_requested'
  | 'account_type_gated'
  | 'no_provider';

export interface AnalyticsAccessEntry {
  requirementId: string;
  state: AnalyticsAccessState;
  missingScopes: string[];
  gains: string;
  /** Present for `account_type_gated`: what the creator would have to do. */
  resolution?: string;
  /** Present for `no_provider`: the spec that will build it. */
  plannedIn?: string;
}

export interface AnalyticsAccess {
  /**
   * `not_authorised` when any implemented surface is unreachable. It is a
   * different fact from a connection that is authorised and has no data in the
   * window, and the two must never render alike.
   */
  summary: 'authorised' | 'not_authorised' | 'unknown' | 'no_provider';
  /** True when reconnecting now would change something. */
  canReconnect: boolean;
  entries: AnalyticsAccessEntry[];
}

/**
 * Surfaces the vendor refused despite the scope being held, recorded on
 * `platform_connections.metadata.analytics_account_gated` by the sync job.
 */
export function readAccountGated(metadata: unknown): string[] {
  if (typeof metadata !== 'object' || metadata === null) return [];

  const gated = (metadata as { analytics_account_gated?: unknown })
    .analytics_account_gated;

  return Array.isArray(gated)
    ? gated.filter((id): id is string => typeof id === 'string')
    : [];
}

export function resolveAnalyticsAccess(input: {
  platform: string;
  grantedScopes: readonly string[] | null | undefined;
  metadata?: unknown;
  /**
   * Which platforms' connect requests carry the analytics scopes
   * (`analyticsScopesEnabled()`, server-only). Required, so no caller can
   * offer a reconnect that would ask for the same scopes again.
   */
  scopesEnabled: AnalyticsScopeSwitch;
}): AnalyticsAccess | null {
  if (!isAnalyticsAuthPlatform(input.platform)) return null;

  const granted = new Set(input.grantedScopes ?? []);
  const gated = new Set(readAccountGated(input.metadata));

  const entries = ANALYTICS_SCOPE_REQUIREMENTS.filter(
    (requirement) => requirement.platform === input.platform,
  ).map((requirement): AnalyticsAccessEntry => {
    const missingScopes = requirement.scopes.filter(
      (scope) => !granted.has(scope),
    );
    const base = {
      requirementId: requirement.id,
      missingScopes,
      gains: requirement.gains,
    };

    if (requirement.provider !== 'implemented') {
      return { ...base, state: 'no_provider', plannedIn: requirement.provider };
    }

    if (granted.size === 0) {
      return { ...base, missingScopes: [], state: 'unknown' };
    }

    if (missingScopes.length > 0) {
      const withheld = missingScopes.some((scope) =>
        isScopeWithheld(input.platform, scope, input.scopesEnabled),
      );

      return {
        ...base,
        state: withheld
          ? 'not_requested'
          : canBeGranted(requirement)
            ? 'scope_missing'
            : 'review_pending',
      };
    }

    if (requirement.accountGate && gated.has(requirement.id)) {
      return {
        ...base,
        state: 'account_type_gated',
        resolution: requirement.accountGate.resolution,
      };
    }

    return { ...base, state: 'authorised' };
  });

  const implemented = entries.filter((entry) => entry.state !== 'no_provider');

  return {
    summary:
      implemented.length === 0
        ? 'no_provider'
        : implemented.every((entry) => entry.state === 'authorised')
          ? 'authorised'
          : implemented.every((entry) => entry.state === 'unknown')
            ? 'unknown'
            : 'not_authorised',
    canReconnect: entries.some(
      (entry) => entry.state === 'scope_missing' || entry.state === 'unknown',
    ),
    entries,
  };
}

function canBeGranted(requirement: AnalyticsScopeRequirement) {
  return (
    requirement.review === 'approved' || requirement.review === 'not_required'
  );
}

/**
 * Whether the sync job may call this platform's per-video analytics for a
 * connection. `not_authorised` means the call is known to fail before it is
 * made, so it is not made. `unknown` is a connection with no recorded grant:
 * it is still tried, because refusing it would stop a working connection that
 * merely predates the record.
 */
export function videoSyncAuthorisation(input: {
  platform: string;
  grantedScopes: readonly string[] | null | undefined;
}): 'authorised' | 'not_authorised' | 'unknown' {
  const requirementId = VIDEO_SYNC_REQUIREMENT[input.platform];
  // Any switch gives the same answer here: the switch only chooses among the
  // ways of *not* holding a scope, and all of them are `not_authorised` below
  // (asserted in analytics-scope-switch.test.ts). So the sync needs no setting.
  const state = resolveAnalyticsAccess({
    ...input,
    scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
  })?.entries.find((entry) => entry.requirementId === requirementId)?.state;

  if (state === 'authorised' || state === 'unknown') return state;

  return 'not_authorised';
}

const VIDEO_SYNC_REQUIREMENT: Record<string, string | undefined> = {
  youtube: 'youtube.analytics',
  tiktok: 'tiktok.video-metrics',
  instagram: 'instagram.insights',
  facebook: 'facebook.video-insights',
  twitter: 'x.post-analytics',
};

export function holdsRequirement(
  requirementId: string,
  grantedScopes: readonly string[] | null | undefined,
): boolean {
  const requirement = ANALYTICS_SCOPE_REQUIREMENTS.find(
    ({ id }) => id === requirementId,
  );

  if (!requirement) return false;

  const granted = new Set(grantedScopes ?? []);

  return requirement.scopes.every((scope) => granted.has(scope));
}
