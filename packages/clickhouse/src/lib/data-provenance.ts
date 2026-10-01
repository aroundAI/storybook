/**
 * Data provenance capability model (FILM-1703).
 *
 * The single definition of which platform can supply which metric, and of
 * why a number is absent when it is. The analytics page presents YouTube,
 * TikTok and Instagram figures as one kind of thing; they are not, and the
 * differences are large enough to invert a conclusion.
 *
 * Pure, and it imports nothing but types — no ClickHouse driver, no
 * `server-only` — for the reason `traffic-groups.ts` gives in its own
 * header: a client component can read it without pulling the driver into
 * the bundle. `__tests__/data-provenance.test.ts` asserts that.
 *
 * **The matrix stays in code.** Moving it into the database, or making it
 * account-overridable, kills the writer-binding test that is its whole
 * guarantee. A matrix that drifts from the pipeline is worse than none,
 * because it is believed.
 *
 * Vendor facts come from `docs/platform-capability-reference.md`
 * (FILM-1721), never from our own provider types: every entry cites the
 * section and field-index block it was read from, and
 * `capability-matrix-reference.test.ts` in `@kit/content-analytics` fails an
 * entry that names a field the reference does not carry.
 */
import type {
  AnalyticsPlatform,
  AudienceDimension,
  MetricSource,
} from '../types';

/** Every value of `AnalyticsPlatform`, in the order a surface lists them. */
export const ANALYTICS_PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
] as const satisfies readonly AnalyticsPlatform[];

// `satisfies` stops a name that is not a platform getting in. It cannot stop
// one being left out, and vitest does not typecheck, so the suite reads the
// union out of types.ts and compares.

export function isAnalyticsPlatform(value: string): value is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The guard every platform predicate passes before it reaches SQL
 * (FILM-1709). Two mistakes it refuses, both of which used to answer
 * quietly:
 *
 * - **An empty list.** `platforms.length > 0 &&` read "none selected" as
 *   "no filter", so clearing the filter showed every platform. No platform
 *   selected is the page's state to say, never a query's to guess.
 * - **A name outside `AnalyticsPlatform`.** Facebook is offered for export
 *   and connected channels can be anything; the metric tables' `platform`
 *   column is an Enum of three, so an unknown name is a server error there
 *   and an empty answer on `video_dim`, which is a String.
 */
export function assertPlatformSelection(
  platforms: readonly string[],
): asserts platforms is readonly AnalyticsPlatform[] {
  if (platforms.length === 0) {
    throw new Error(
      'A platform filter needs at least one platform; leave it out to read every platform',
    );
  }

  const unknown = platforms.filter(
    (platform) => !isAnalyticsPlatform(platform),
  );

  if (unknown.length > 0) {
    throw new Error(
      `Not an analytics platform: ${unknown.join(', ')} (expected ${ANALYTICS_PLATFORMS.join(', ')})`,
    );
  }
}

/**
 * What a card can be showing. One family is one question a creator asks —
 * "how long did they watch?" — not one column.
 */
export const METRIC_FAMILIES = [
  'engagement', // views/likes/comments/shares     → video_metrics
  'reposts', // a post's reposts                 → video_metrics
  'all_surface_engagement', // incl. boosted     → video_metrics
  'watch_time', //                                 → video_metrics
  'revenue', // estimated earnings, USD            → video_revenue_daily
  'traffic_sources', //                            → video_traffic_sources
  'retention_curve', //                            → video_retention_curves
  'reach', // impressions, CTR                     → video_reach_daily
  'accounts_reached', // a post's unique accounts    → video_metrics
  'channel_accounts_reached', // a channel's, per window → channel_windows
  'channel_totals', // subscribers / followers     → channel_daily, channel_subscribers
  'demographics', // age, gender                   → video_audience
  'geography', // country, city                    → video_audience
  'device', // device type, operating system       → video_audience
  'follower_status', // subscribed vs not          → video_audience
] as const;

export type MetricFamily = (typeof METRIC_FAMILIES)[number];

/**
 * The ClickHouse tables a family can be read from.
 *
 * `video_snapshots` and `video_dim` are deliberately absent: one is the
 * baseline store a `derived` figure is computed from and the other is a
 * dimension table, so no card shows either.
 *
 * `channel_reach_daily` (FILM-1504) is listed so its writer is bound like
 * every other, though no family names it yet: the channel-wide reach card
 * that would read it is FILM-1511's.
 */
export type SourceTable =
  | 'video_metrics'
  | 'video_traffic_sources'
  | 'video_retention_curves'
  | 'video_reach_daily'
  | 'video_revenue_daily'
  | 'channel_daily'
  | 'channel_reach_daily'
  | 'channel_subscribers'
  | 'channel_windows'
  | 'video_audience';

/**
 * The four levels — and never a fifth (phase 17, locked decision).
 *
 * - `native`       the platform reports it and we ingest it directly
 * - `derived`      we compute it from something the platform reports
 * - `not_ingested` the platform can report it; **we** have not built it
 * - `unsupported`  the platform has nothing to fetch
 *
 * A single "limited" label collapses the last two, and in doing so tells a
 * creator to stop asking for something we could build. There is deliberately
 * no *fabricated* level: keeping the model unable to express fabrication is
 * what stops the next person reaching for it.
 */
export type SupportLevel =
  | 'native'
  | 'derived'
  | 'not_ingested'
  | 'unsupported';

/**
 * The four levels ranked strongest first (FILM-1714). The four levels alone
 * have no order, so "the weakest input" means nothing until this list
 * exists. A figure computed from several families is only as good as its
 * weakest one.
 *
 * - `native` above `derived`: a snapshot delta is dated to the day we
 *   checked, not the day it happened, so it is softer than a figure the
 *   platform reports per day.
 * - `derived` above both absent levels: it is a number, and they are not.
 * - `not_ingested` above `unsupported`: both give no number, but this is a
 *   product call. A signal with one input we have not built yet and another
 *   input the platform reports can be built. One with an `unsupported`
 *   input can never exist, whatever we ship. So when the inputs disagree,
 *   `unsupported` wins. Ranking the other way would keep a signal that can
 *   never be built in the backlog as "dark", and send someone off to build
 *   the half that can be built for nothing.
 */
export const SUPPORT_ORDER = [
  'native',
  'derived',
  'not_ingested',
  'unsupported',
] as const satisfies readonly SupportLevel[];

/** The weakest of `levels` under `SUPPORT_ORDER`. Needs at least one level. */
export function weakestSupport(
  levels: readonly [SupportLevel, ...SupportLevel[]],
): SupportLevel {
  return levels.reduce((weakest, level) =>
    SUPPORT_ORDER.indexOf(level) > SUPPORT_ORDER.indexOf(weakest)
      ? level
      : weakest,
  );
}

export type DerivationMethod =
  | 'snapshot_delta_fetch_day' // delta attributed to the fetch day
  | 'percentage_only' // provider reports share, not counts
  | 'account_level' // dimension describes the channel, not the asset
  | 'publish_attribute';

/**
 * Whether we are permitted to ask. Orthogonal to `SupportLevel`: Instagram
 * is capable and implemented and still returns nothing, because a permission
 * is missing. Each state has a different owner and a different sentence.
 */
export type AccessState =
  | 'authorised' // our config asks and no vendor review blocks it; see AccessVerified
  | 'scope_missing' // the scope exists; our OAuth config does not ask
  | 'review_required' // App Review / audit needed before we may ask
  | 'review_pending'
  | 'review_denied'
  | 'account_type_gated'; // e.g. TikTok Business account — the creator's call

/**
 * The states that are ours to resolve. `account_type_gated` is the creator's,
 * depends on who is asking, and so cannot be a static fact: the matrix
 * carries it as `accountGate` and `accessFor` resolves it per creator.
 */
export type OurAccessState = Exclude<AccessState, 'account_type_gated'>;

/**
 * Whether an `authorised` surface has been seen working against a real
 * account. `authorised` alone says our OAuth config asks for the scope and
 * nothing on the vendor's side is known to stand in the way; that is a claim
 * about our configuration, not a measurement. "Cannot measure" is not
 * "measured", so every authorised entry carries exactly one of these.
 */
export interface AccessVerified {
  /** ISO date it was seen working. */
  on: string;
  /** How: the account, environment and what came back. */
  how: string;
}

export interface AccessPendingVerification {
  /** A spec id, or `'owner'` when only the owner can answer. */
  owner: string;
  /** What has to be seen before this can say `verified`. */
  question: string;
}

/** Whether we can obtain it commercially. */
export type Availability = 'included' | 'metered' | 'tier_gated' | 'unknown';

export interface DataWindow {
  /**
   * How far back the platform serves data. `null` = unbounded.
   * `'undocumented'` = the vendor does not say; only with `availability:
   * 'unknown'`, whose owner and question are what settles it (X's
   * `/2/media/analytics`, FILM-1727 §3).
   */
  maxAgeDays: number | null | 'undocumented';
  /**
   * What the window is measured from, which matters as much as its length.
   * YouTube's reporting backfill is 30 days from **job creation**, so it
   * shrinks the longer a channel waits to be onboarded; a publish-anchored
   * window is fixed per post.
   */
  anchoredOn: 'publish_date' | 'job_creation' | 'request_date';
  stopsUpdatingAfterDays?: number;
  /** The reference's ledger marks this window inferred, not documented. */
  inferred?: true;
}

/**
 * A requirement on the creator's own account that no work of ours removes.
 * TikTok's Business account and YouTube Partner Program membership are the
 * two instances.
 */
export interface AccountTypeGate {
  /** What the creator needs, as a noun phrase. */
  requirement: string;
  /** The sentence a creator without it reads. Rendered verbatim. */
  note: string;
}

/**
 * Where in `docs/platform-capability-reference.md` the entry was read from.
 *
 * `surface` names a `<!-- fields: … -->` block and `fields` the vendor names
 * inside it. An `unsupported` entry has nothing to name, so it cites only the
 * section that records the absence.
 */
export interface CapabilityCitation {
  section: string;
  surface: string | null;
  fields: readonly string[];
}

type LevelAxis =
  | {
      level: 'native';
      table: SourceTable;
      method?: undefined;
      blockedBy?: undefined;
    }
  | {
      level: 'derived';
      table: SourceTable;
      method: DerivationMethod;
      blockedBy?: undefined;
    }
  // `blockedBy` is a spec id: what has to ship before this becomes `native`.
  | {
      level: 'not_ingested';
      table: null;
      method?: undefined;
      blockedBy: string;
    }
  // `null`, not absent: nothing blocks it, because there is nothing to build.
  | {
      level: 'unsupported';
      table: null;
      method?: undefined;
      blockedBy: null;
    };

type NoVerification = {
  verified?: undefined;
  pendingVerification?: undefined;
};

type AccessAxis =
  | {
      access: 'authorised';
      verified: AccessVerified;
      pendingVerification?: undefined;
    }
  | {
      access: 'authorised';
      verified?: undefined;
      pendingVerification: AccessPendingVerification;
    }
  | ({ access: 'scope_missing' | 'review_required' } & NoVerification)
  // ISO date the review was submitted, or refused.
  | ({
      access: 'review_pending' | 'review_denied';
      accessSince: string;
    } & NoVerification);

type AvailabilityAxis =
  | { availability: 'included' | 'metered' | 'tier_gated' }
  // Not a default. It means we asked and the vendor does not publish it, so
  // it carries who owns asking and what the question is.
  | { availability: 'unknown'; unknownOwner: string; unknownQuestion: string };

/**
 * One (family, platform) claim. Four axes, not one level: capability,
 * access, availability and window are independent, and collapsing absence
 * for any reason into `level` is what the four-level rule protects against.
 *
 * The `iff` rules the spec states — `method` with `derived`, `table` with
 * data, `blockedBy` with `not_ingested` — are carried by the unions above, so
 * an entry that breaks one does not compile. The suite asserts them again at
 * runtime for the cases a cast can get past.
 */
export type PlatformCapability = LevelAxis &
  AccessAxis &
  AvailabilityAxis & {
    window: DataWindow;
    accountGate?: AccountTypeGate;
    /**
     * One sentence, rendered verbatim to a creator asking why a number is
     * missing or soft. Not developer commentary; writing it is part of
     * adding an entry.
     */
    note: string;
    /**
     * Only on `engagement`, and exactly where the platform has no views
     * column (FILM-1722's registry): one sentence, rendered verbatim, saying
     * why it adds nothing to a views total. A null Views figure reads it
     * (KB-166); the binding test is `views-not-measured-reason.test.ts`.
     */
    viewsNote?: string;
    /**
     * Raw source names the platform reports, for the FILM-1708 drill-down.
     * Unset today: YouTube's live in `traffic-groups.ts`, which this module
     * may not import a value from, and nobody else has any.
     */
    nativeSources?: readonly string[];
    reference: CapabilityCitation;
  };

// ---------------------------------------------------------------------------
// Surfaces. The three axes below `level` are facts about an API surface, not
// about a metric, so each is stated once and spread into the entries that
// use it. Everything that makes an entry an individual claim — level, table,
// method, blocker, note, citation — is written out per entry and never
// defaulted: the repetition is what keeps each one reviewable.
// ---------------------------------------------------------------------------

type SurfaceAxes = AccessAxis &
  AvailabilityAxis & { window: DataWindow; accountGate?: AccountTypeGate };

/**
 * Pending on the owner, not on a vendor check: YouTube rows arrive in local
 * and CI ClickHouse from fixtures, which proves the pipeline, not the scope.
 * Asked 2026-09-25; the owner's answer: "Not yet" — no real channel has been
 * seen syncing. It becomes `verified` with the date and how once one has.
 */
const YOUTUBE_LIVE_SYNC = {
  owner: 'owner',
  question:
    'Has a real YouTube channel, connected outside production, been seen syncing through this API, and when?',
} as const satisfies AccessPendingVerification;

/** Analytics API. "authorised, except revenue" per the reference summary. */
const YOUTUBE_ANALYTICS = {
  access: 'authorised',
  pendingVerification: YOUTUBE_LIVE_SYNC,
  availability: 'included',
  window: { maxAgeDays: null, anchoredOn: 'request_date' },
} as const satisfies SurfaceAxes;

/** Reporting API. Backfill is 30 days from job creation, permanently. */
const YOUTUBE_REPORTING = {
  access: 'authorised',
  pendingVerification: YOUTUBE_LIVE_SYNC,
  availability: 'included',
  window: { maxAgeDays: 30, anchoredOn: 'job_creation' },
} as const satisfies SurfaceAxes;

/**
 * Display API. `review_required`, not `scope_missing`: the reference records
 * that app review is mandatory for production on every scope, so
 * reconnecting an account today would gain a creator nothing.
 */
const TIKTOK_DISPLAY = {
  access: 'review_required',
  availability: 'included',
  window: { maxAgeDays: null, anchoredOn: 'request_date' },
} as const satisfies SurfaceAxes;

const TIKTOK_BUSINESS_ACCOUNT: AccountTypeGate = {
  requirement: 'a TikTok Business account',
  note: 'TikTok only shares these figures for Business accounts, so switching your TikTok account to a Business account is the first step.',
};

/**
 * Business API: a separate portal, app registration and review on our side,
 * and a Business account on the creator's. Post data stops updating 365 days
 * after publish.
 */
const TIKTOK_BUSINESS = {
  access: 'review_required',
  accountGate: TIKTOK_BUSINESS_ACCOUNT,
  availability: 'included',
  window: {
    maxAgeDays: null,
    anchoredOn: 'publish_date',
    stopsUpdatingAfterDays: 365,
  },
} as const satisfies SurfaceAxes;

/**
 * Media insights. `instagram_manage_insights` is not requested, and serving
 * creators we do not own needs Advanced Access — App Review and Business
 * Verification, both. The ~2 year window is in the reference's ledger as
 * inferred.
 */
const INSTAGRAM_MEDIA = {
  access: 'review_required',
  availability: 'included',
  window: { maxAgeDays: 730, anchoredOn: 'publish_date', inferred: true },
} as const satisfies SurfaceAxes;

/** Account insights. Same permission; ~90 days, also inferred. */
const INSTAGRAM_ACCOUNT = {
  access: 'review_required',
  availability: 'included',
  window: { maxAgeDays: 90, anchoredOn: 'request_date', inferred: true },
} as const satisfies SurfaceAxes;

/**
 * The IG User node, read with `instagram_basic` — which we request, and
 * which the connect callback exercises against every account it links. That
 * callback running against a real account is what would verify it. Asked
 * 2026-09-25; the owner's answer: "Not yet".
 */
const INSTAGRAM_USER = {
  access: 'authorised',
  pendingVerification: {
    owner: 'owner',
    question:
      'Has a real Instagram account, connected outside production, been seen returning followers_count, and when?',
  },
  availability: 'included',
  window: { maxAgeDays: null, anchoredOn: 'request_date' },
} as const satisfies SurfaceAxes;

/**
 * Video insights, the video's Page post and its insights (FILM-1720), read
 * with a Page token. `read_insights` and `pages_manage_engagement` are asked
 * for only while `ANALYTICS_SCOPES_ENABLED` names `facebook`, and App Review
 * stands between us and any Page we do not own: shipped dark (owner,
 * 2026-10-01). Meta keeps two years of video insights, counted back from
 * the request: "Data is only available for the past 2 years" (video_insights
 * reference, read 2026-10-02). Nothing ends a video's insights two years
 * after it was posted (KB-163).
 */
const FACEBOOK_VIDEO = {
  access: 'review_required',
  availability: 'included',
  window: { maxAgeDays: 730, anchoredOn: 'request_date' },
} as const satisfies SurfaceAxes;

/**
 * X's posts lookup on the pay-per-use tier (FILM-1727): `tweet.read` and
 * `users.read`, already requested for publishing. Metered at $0.005 a post
 * read, and the playback quartiles are non-public metrics, which X serves
 * only for posts under 30 days old, from the post's creation. Every X figure
 * comes from that one call, so the wall bounds them all: the sync stops a day
 * inside it (`lib/x-read-budget.ts` in @kit/content-analytics).
 */
const X_POSTS_LOOKUP = {
  access: 'authorised',
  pendingVerification: {
    owner: 'FILM-1725',
    question:
      'Has a real X account, on a funded pay-per-use plan, been seen returning a video’s non_public_metrics through GET /2/tweets, and when?',
  },
  availability: 'metered',
  window: { maxAgeDays: 30, anchoredOn: 'publish_date' },
} as const satisfies SurfaceAxes;

/**
 * X's Enterprise analytics, `/2/media/analytics` and `/2/tweets/analytics`.
 * Declared and dark: nothing calls them. Whether they are Enterprise-only is
 * FILM-1725 Check A; how far back they serve, and at what price, only X
 * sales can say, in writing. Until then the availability is `unknown`, which
 * is FILM-1703's own example of it.
 */
const X_ENTERPRISE = {
  access: 'authorised',
  pendingVerification: {
    owner: 'FILM-1725',
    question:
      'Check A: does GET /2/media/analytics answer a pay-per-use token, or refuse it as Enterprise-only?',
  },
  availability: 'unknown',
  unknownOwner: 'owner',
  unknownQuestion:
    'X sales, in writing: how far back does GET /2/media/analytics serve data, and what does the Enterprise tier cost?',
  window: { maxAgeDays: 'undocumented', anchoredOn: 'request_date' },
} as const satisfies SurfaceAxes;

/**
 * "Only Page admins can query earnings insights by using the API"
 * (capability reference, Facebook). A Page that runs no ad breaks has no
 * ad-break earnings to report.
 */
const FACEBOOK_PAGE_EARNINGS: AccountTypeGate = {
  requirement: 'admin rights on a Facebook Page that earns from ad breaks',
  note: 'Facebook reports ad-break earnings only to the admin of a Page that earns from ad breaks, so there is nothing to show for this Page.',
};

const YOUTUBE_PARTNER_PROGRAM: AccountTypeGate = {
  requirement: 'YouTube Partner Program membership',
  note: 'YouTube only reports earnings for channels in the YouTube Partner Program, so there is nothing to show until your channel joins it.',
};

export const CAPABILITY_MATRIX: Record<
  MetricFamily,
  Record<AnalyticsPlatform, PlatformCapability>
> = {
  engagement: {
    youtube: {
      level: 'native',
      table: 'video_metrics',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports views, likes, comments and shares for each day, and we record them as reported.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-metrics',
        fields: ['views', 'likes', 'comments', 'shares'],
      },
    },
    tiktok: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...TIKTOK_DISPLAY,
      note: 'TikTok only reports lifetime totals, so each day shows the change since we last checked, dated to the day we checked rather than the day it happened.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/display-video',
        fields: ['view_count', 'like_count', 'comment_count', 'share_count'],
      },
    },
    instagram: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...INSTAGRAM_MEDIA,
      note: 'Instagram only reports lifetime totals, so each day shows the change since we last checked, dated to the day we checked rather than the day it happened.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/media-insights',
        fields: ['views', 'likes', 'comments', 'saved', 'shares'],
      },
    },
    // `views` is NULL on every Facebook row (migration 020): its four kinds
    // of view are their own columns, and FILM-1722 names none of them views.
    facebook: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...FACEBOOK_VIDEO,
      note: 'Facebook only reports lifetime totals, so each day shows the reactions, comments and shares since we last checked, dated to the day we checked; it counts four different kinds of view and none is a view in YouTube’s sense, so Facebook adds nothing to a views total.',
      viewsNote:
        'Facebook counts four different kinds of view, and none of them is a view in this sense, so its plays are not counted as views.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/video-insights',
        fields: [
          'total_video_reactions_by_type_total',
          'post_video_likes_by_reaction_type',
        ],
      },
    },
    // X's shares are Enterprise-only, so `shares` is NULL on every X row
    // (migration 021). Its reposts are the `reposts` family.
    twitter: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...X_POSTS_LOOKUP,
      note: 'X only reports lifetime views, likes, replies and bookmarks, so each day shows the change since we last checked, dated to the day we checked, and X shares are not reported at all.',
      reference: {
        section: 'X',
        surface: 'x/post-metrics',
        fields: ['like_count', 'reply_count', 'bookmark_count'],
      },
    },
  },

  // Its own family, not engagement: `reposts_count` is a Media node field,
  // a different surface from the insights the rest of engagement comes from.
  reposts: {
    youtube: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube has no reposts.',
      reference: { section: 'YouTube', surface: null, fields: [] },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok does not report how often a video was reposted.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    instagram: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...INSTAGRAM_MEDIA,
      note: 'Instagram reports how many times a post or Reel has been reposted so far, so each day shows the reposts since we last checked, dated to the day we checked; Stories show none.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/media-fields',
        fields: ['reposts_count'],
      },
    },
    facebook: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...FACEBOOK_VIDEO,
      note: 'Facebook does not report how often a video was reposted; its shares are counted under engagement.',
      reference: { section: 'Facebook', surface: null, fields: [] },
    },
    twitter: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...X_POSTS_LOOKUP,
      note: 'X reports how many times a post has been reposted so far, so each day shows the reposts since we last checked, dated to the day we checked.',
      reference: {
        section: 'X',
        surface: 'x/post-metrics',
        fields: ['retweet_count'],
      },
    },
  },

  // Not engagement: these fold in boosted placements (and replays, for
  // views), so they are a different number from the engagement family's
  // views, likes and comments. Defined in INSTAGRAM_AGGREGATES (FILM-1722).
  all_surface_engagement: {
    youtube: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports no totals that fold in paid placements.',
      reference: { section: 'YouTube', surface: null, fields: [] },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok reports no totals that fold in paid placements.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    instagram: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...INSTAGRAM_MEDIA,
      note: 'Instagram also reports views, likes and comments across every surface, boosted placements included (and replays, for views), so they run higher than the ordinary figures and are kept apart from them; each day shows the increase since we last checked, dated to the day we checked; Stories show none.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/media-fields',
        fields: [
          'total_views_count',
          'total_like_count',
          'total_comments_count',
        ],
      },
    },
    // Facebook's 3-second views already include promoted plays, split
    // organic and paid in their own columns (FILM-1720): no separate total.
    facebook: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports no separate total across paid placements; its 3-second views already count promoted plays, split into organic and paid.',
      reference: { section: 'Facebook', surface: null, fields: [] },
    },
    // X documents promoted metrics apart, for promoted posts only (FILM-1727):
    // no total across placements, and the sync reads none of them.
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X reports no total across paid placements; a promoted post’s paid figures come separately, and we read only its public and non-public ones.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  watch_time: {
    youtube: {
      level: 'native',
      table: 'video_metrics',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports minutes watched and average view duration for each day, and we record them as reported.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-metrics',
        fields: [
          'estimatedMinutesWatched',
          'averageViewDuration',
          'averageViewPercentage',
        ],
      },
    },
    // Same level as Instagram and not the same price: this one is a second
    // integration, FILM-1730 (TikTok Business API).
    tiktok: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1730',
      ...TIKTOK_BUSINESS,
      note: 'TikTok does report watch time, through a separate Business integration we have not built yet, so no TikTok watch time is shown.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/business',
        fields: [
          'total_time_watched',
          'average_time_watched',
          'full_video_watched_rate',
        ],
      },
    },
    // The family is the stored total. Meta's own average and the skip rate
    // are on video_snapshots since KB-151 (migration 023), read by the
    // signal map rather than this entry.
    instagram: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...INSTAGRAM_MEDIA,
      note: 'Instagram reports total watch time for Reels only, so each day shows the minutes added since we last checked, dated to the day we checked; other posts show none.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/media-insights',
        fields: ['ig_reels_video_view_total_time'],
      },
    },
    // Total time only. Meta's own averages (`total_video_avg_time_watched`,
    // `post_video_avg_time_watched`) are not requested: the Reels one counts
    // replay time over initial plays and can exceed the video's length.
    facebook: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports total time watched so far, replays included, so each day shows the minutes added since we last checked, dated to the day we checked.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/video-insights',
        fields: ['total_video_view_total_time', 'post_video_view_time'],
      },
    },
    twitter: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1727',
      ...X_ENTERPRISE,
      note: 'X reports watch time only on its Enterprise plan, which we do not hold, so no X watch time is shown.',
      reference: {
        section: 'X',
        surface: 'x/media-analytics',
        fields: ['watch_time_ms'],
      },
    },
  },

  revenue: {
    // `yt-analytics-monetary.readonly` is now requested (FILM-1711), so
    // `access` moved off `scope_missing`. Nobody has seen Google grant it or
    // seen revenue come back (FILM-1725 Checks F and G), so it is pending.
    // A connection made before FILM-1711 does not hold it at all; that is
    // per connection, and `resolveAnalyticsAccess` (publishing) answers it.
    // `monetisationAccess` turns the two into one creator's sentence.
    //
    // `level` is ClickHouse ingestion, a separate axis. Since FILM-1726 the
    // sync writes each day YouTube reports to `video_revenue_daily`, and
    // only for an authorised read. A day with no row was not measured.
    youtube: {
      level: 'native',
      table: 'video_revenue_daily',
      access: 'authorised',
      pendingVerification: {
        owner: 'FILM-1725',
        question:
          'Checks F and G: does Google grant yt-analytics-monetary.readonly on the consent screen, and does a Partner Program channel then return non-zero revenue?',
      },
      accountGate: YOUTUBE_PARTNER_PROGRAM,
      availability: 'included',
      window: YOUTUBE_ANALYTICS.window,
      note: 'YouTube reports estimated earnings for each day, in US dollars, once your channel has given permission to read them; a day without that permission shows as not measured, not as $0.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-metrics',
        fields: [
          'estimatedRevenue',
          'estimatedAdRevenue',
          'estimatedRedPartnerRevenue',
        ],
      },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok does not report what a video earned, so TikTok revenue is only what you enter yourself.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    instagram: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...INSTAGRAM_MEDIA,
      note: 'Instagram does not report what a post earned, so Instagram revenue is only what you enter yourself.',
      reference: { section: 'Instagram', surface: null, fields: [] },
    },
    // FILM-1720 decided only this: ad-break earnings are not ingested.
    // Whether a Monetisation stage exists is FILM-1726's.
    facebook: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1726',
      ...FACEBOOK_VIDEO,
      accountGate: FACEBOOK_PAGE_EARNINGS,
      note: 'Facebook reports ad-break earnings to Page admins, but we do not collect them yet, so Facebook revenue here is only what you enter yourself.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/video-insights',
        fields: ['total_video_ad_break_earnings'],
      },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report what a post earned, so X revenue is only what you enter yourself.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  traffic_sources: {
    youtube: {
      level: 'native',
      table: 'video_traffic_sources',
      ...YOUTUBE_REPORTING,
      note: 'YouTube reports where each day’s views came from, and we record it as reported.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/reporting',
        fields: ['channel_traffic_source_a3'],
      },
    },
    // Our gap, not TikTok's, twice over: the Business app we have not
    // registered, and the mapping from `impression_sources` to traffic groups
    // we have not written. FILM-1730 owns both.
    tiktok: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1730',
      ...TIKTOK_BUSINESS,
      note: 'TikTok does report where views came from, through a separate Business integration we have not built yet, so traffic sources cover YouTube only.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/business',
        fields: ['impression_sources'],
      },
    },
    instagram: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...INSTAGRAM_MEDIA,
      note: 'Instagram does not report where a post’s views came from.',
      reference: { section: 'Instagram', surface: null, fields: [] },
    },
    facebook: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...FACEBOOK_VIDEO,
      note: 'Facebook does not report where a video’s views came from, only whether they were organic or paid.',
      reference: { section: 'Facebook', surface: null, fields: [] },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report where a post’s views came from.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  retention_curve: {
    youtube: {
      level: 'native',
      table: 'video_retention_curves',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports how much of the audience is still watching at 100 points through each video.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-metrics',
        fields: ['audienceWatchRatio'],
      },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok does not report a retention curve on any of its APIs.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    instagram: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...INSTAGRAM_MEDIA,
      note: 'Instagram does not report a retention curve or a completion rate.',
      reference: { section: 'Instagram', surface: null, fields: [] },
    },
    // `total_video_retention_graph`: 40 equal intervals. The Reels graph
    // names no segment count, so it is not requested.
    facebook: {
      level: 'native',
      table: 'video_retention_curves',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports how many plays were still going at 40 points through each video, as a share of all its 3-second views.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/video-insights',
        fields: ['total_video_retention_graph'],
      },
    },
    // Five points, not a curve: the share of plays that reached 0, 25, 50,
    // 75 and 100% of the video. A different quotient from YouTube's, so its
    // signal is `quartile_retention`, never `audience_retention`.
    twitter: {
      level: 'native',
      table: 'video_retention_curves',
      ...X_POSTS_LOOKUP,
      note: 'X reports how many plays reached a quarter, half, three quarters and the end of a video, so its curve has those five points rather than a full line.',
      reference: {
        section: 'X',
        surface: 'x/media-object',
        fields: [
          'playback_0_count',
          'playback_25_count',
          'playback_50_count',
          'playback_75_count',
          'playback_100_count',
        ],
      },
    },
  },

  reach: {
    youtube: {
      level: 'native',
      table: 'video_reach_daily',
      ...YOUTUBE_REPORTING,
      note: 'YouTube reports thumbnail impressions and click-through rate for each day, and we record them as reported.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/reporting',
        fields: [
          'video_thumbnail_impressions',
          'video_thumbnail_impressions_ctr',
        ],
      },
    },
    tiktok: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1730',
      ...TIKTOK_BUSINESS,
      note: 'TikTok does report how many people a video reached, through a separate Business integration we have not built yet, so reach covers YouTube only.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/business',
        fields: ['reach'],
      },
    },
    // Instagram's `reach` counts accounts, not impressions: it is stored as
    // `accounts_reached` (FILM-1712) and read under that family.
    instagram: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...INSTAGRAM_MEDIA,
      note: 'Instagram stopped reporting impressions in 2025 and never reported click-through; how many accounts saw a post is under accounts reached.',
      reference: { section: 'Instagram', surface: null, fields: [] },
    },
    // Not impressions: those went with Graph v26.0. `post_media_view` is
    // Meta's named replacement, counted on the video's Page post.
    facebook: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports how many times a video was played or shown so far, so each day shows the change since we last checked; it stopped reporting impressions in 2026 and never reported click-through.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/post-insights',
        fields: ['post_media_view'],
      },
    },
    // `impression_count` is on the same call; storing it needs a lifetime
    // impressions baseline we do not keep yet.
    twitter: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1727',
      ...X_POSTS_LOOKUP,
      note: 'X reports how many times a post was seen, but we do not record that figure yet, so X reach is not shown.',
      reference: {
        section: 'X',
        surface: 'x/post-metrics',
        fields: ['impression_count'],
      },
    },
  },

  // Unique accounts, not views: one person counted once. Never summed across
  // posts, channels or platforms; `src/reach.ts` is the only reader.
  accounts_reached: {
    youtube: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports how many times a video was viewed, not how many different people watched it.',
      reference: { section: 'YouTube', surface: null, fields: [] },
    },
    tiktok: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1730',
      ...TIKTOK_BUSINESS,
      note: 'TikTok reports how many people a video reached only through a Business integration we have not built yet.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/business',
        fields: ['reach'],
      },
    },
    instagram: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...INSTAGRAM_MEDIA,
      note: 'Instagram reports how many accounts have seen a post so far, so each day shows the new ones since we last checked, dated to the day we checked.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/media-insights',
        fields: ['reach'],
      },
    },
    facebook: {
      level: 'derived',
      table: 'video_metrics',
      method: 'snapshot_delta_fetch_day',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports how many different people have viewed a video’s post so far, so each day shows the new ones since we last checked, dated to the day we checked.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/post-insights',
        fields: ['post_total_media_view_unique'],
      },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X reports how many times a post was seen, not how many different people saw it.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  // A channel's unique accounts over a whole window (7, 30 and the 23 days
  // behind the 7-day "new" figure), recorded nightly. A window figure is not
  // a sum of days, and Meta's longest window is 30 days.
  channel_accounts_reached: {
    youtube: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports how many times your videos were viewed, not how many different people watched them.',
      reference: { section: 'YouTube', surface: null, fields: [] },
    },
    tiktok: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1730',
      ...TIKTOK_BUSINESS,
      note: 'TikTok reports reach only through a Business integration we have not built yet.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/business',
        fields: ['reach'],
      },
    },
    instagram: {
      level: 'native',
      table: 'channel_windows',
      ...INSTAGRAM_ACCOUNT,
      note: 'Instagram reports how many different accounts saw anything of yours over the last 7 or 30 days, and we record it every night.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/user-insights',
        fields: ['reach'],
      },
    },
    facebook: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1720',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports how many different people saw your Page’s content over a day, a week or 28 days, but we do not collect it yet.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/page-insights',
        fields: ['page_total_media_view_unique'],
      },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report how many different people saw anything of yours over a period.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  // Audience size and its movement. YouTube's daily rollup is `channel_daily`;
  // every tracked platform also writes a daily level to `channel_subscribers`
  // (FILM-1607), which is the only channel figure TikTok and Instagram have.
  channel_totals: {
    youtube: {
      level: 'native',
      table: 'channel_daily',
      ...YOUTUBE_REPORTING,
      note: 'YouTube reports channel-wide daily totals and subscribers gained and lost, and we record them as reported.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/reporting',
        fields: ['channel_basic_a3'],
      },
    },
    tiktok: {
      level: 'native',
      table: 'channel_subscribers',
      ...TIKTOK_DISPLAY,
      note: 'TikTok reports your follower count, which we record once a day; it does not report channel-wide daily views.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/display-user',
        fields: ['follower_count'],
      },
    },
    instagram: {
      level: 'native',
      table: 'channel_subscribers',
      ...INSTAGRAM_USER,
      note: 'Instagram reports your follower count, which we record once a day; channel-wide daily views are not collected.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/user-fields',
        fields: ['followers_count'],
      },
    },
    facebook: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1720',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports your Page’s follower count, but we do not record it yet, so no Facebook follower figure is shown.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/page-fields',
        fields: ['followers_count'],
      },
    },
    twitter: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1727',
      ...X_POSTS_LOOKUP,
      note: 'X reports your follower count, but we do not record it yet, so no X follower history is shown.',
      reference: {
        section: 'X',
        surface: 'x/users-me',
        fields: ['followers_count'],
      },
    },
  },

  demographics: {
    youtube: {
      level: 'native',
      table: 'video_audience',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports each video’s viewers by age group and gender, as a share of views.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-dimensions',
        fields: ['ageGroup', 'gender'],
      },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok does not report the age or gender of a video’s viewers through any API open to us.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    instagram: {
      level: 'derived',
      table: 'video_audience',
      method: 'account_level',
      ...INSTAGRAM_ACCOUNT,
      note: 'Instagram reports the age and gender of your followers as a whole, not of each post’s viewers, so every post shows the same account-wide figures.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/user-insights',
        fields: ['follower_demographics'],
      },
    },
    facebook: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1720',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports each video’s 3-second views by age and gender, but we do not collect them yet.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/video-insights',
        fields: ['total_video_views_by_age_bucket_and_gender'],
      },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report the age or gender of a post’s viewers.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  geography: {
    youtube: {
      level: 'native',
      table: 'video_audience',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports each video’s views by country and city.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-dimensions',
        fields: ['country', 'city'],
      },
    },
    tiktok: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1730',
      ...TIKTOK_BUSINESS,
      note: 'TikTok does report viewers’ countries, through a separate Business integration we have not built yet, so no TikTok geography is shown.',
      reference: {
        section: 'TikTok',
        surface: 'tiktok/business',
        fields: ['audience_countries'],
      },
    },
    instagram: {
      level: 'derived',
      table: 'video_audience',
      method: 'account_level',
      ...INSTAGRAM_ACCOUNT,
      note: 'Instagram reports where your followers are as a whole, not where each post’s viewers are, so every post shows the same account-wide figures.',
      reference: {
        section: 'Instagram',
        surface: 'instagram/user-insights',
        fields: ['follower_demographics'],
      },
    },
    facebook: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1720',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports each video’s views by country, but we do not collect them yet.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/video-insights',
        fields: ['total_video_views_by_country_id'],
      },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report where a post’s viewers are.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  device: {
    youtube: {
      level: 'native',
      table: 'video_audience',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports each video’s views by device type and operating system.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-dimensions',
        fields: ['deviceType', 'operatingSystem'],
      },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok does not report which devices a video was watched on.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    instagram: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...INSTAGRAM_MEDIA,
      note: 'Instagram does not report which devices a post was watched on.',
      reference: { section: 'Instagram', surface: null, fields: [] },
    },
    facebook: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...FACEBOOK_VIDEO,
      note: 'Facebook does not report which devices a video was watched on.',
      reference: { section: 'Facebook', surface: null, fields: [] },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report which devices a post was watched on.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },

  follower_status: {
    youtube: {
      level: 'native',
      table: 'video_audience',
      ...YOUTUBE_ANALYTICS,
      note: 'YouTube reports how many of each video’s views came from subscribers.',
      reference: {
        section: 'YouTube',
        surface: 'youtube/analytics-dimensions',
        fields: ['subscribedStatus'],
      },
    },
    tiktok: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...TIKTOK_DISPLAY,
      note: 'TikTok does not report whether a video’s viewers were already following you.',
      reference: { section: 'TikTok', surface: null, fields: [] },
    },
    // `follow_type` exists, on the account endpoint only. There is no
    // per-media follower split, so no `follower_status` rows are written.
    instagram: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...INSTAGRAM_MEDIA,
      note: 'Instagram does not report whether a post’s viewers were already following you.',
      reference: { section: 'Instagram', surface: null, fields: [] },
    },
    // Narrower than FILM-1720 first recorded: reach has no follower split,
    // but the Page post's `post_media_view` takes an `is_from_followers`
    // breakdown (Insights reference, read 2026-10-01). Not requested.
    facebook: {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1720',
      ...FACEBOOK_VIDEO,
      note: 'Facebook reports how many of a video’s plays and displays came from your followers, though not how many people, and we do not collect that split yet.',
      reference: {
        section: 'Facebook',
        surface: 'facebook/post-insights',
        fields: ['post_media_view'],
      },
    },
    twitter: {
      level: 'unsupported',
      table: null,
      blockedBy: null,
      ...X_POSTS_LOOKUP,
      note: 'X does not report whether a post’s viewers were already following you.',
      reference: { section: 'X', surface: null, fields: [] },
    },
  },
};

// ---------------------------------------------------------------------------
// Accessors — the public API.
// ---------------------------------------------------------------------------

export function capabilityFor(
  family: MetricFamily,
  platform: AnalyticsPlatform,
): PlatformCapability {
  return CAPABILITY_MATRIX[family][platform];
}

function hasData(capability: PlatformCapability): boolean {
  return capability.level === 'native' || capability.level === 'derived';
}

/** Platforms whose figures for this family exist at all, measured or derived. */
export function platformsWithData(family: MetricFamily): AnalyticsPlatform[] {
  return ANALYTICS_PLATFORMS.filter((platform) =>
    hasData(capabilityFor(family, platform)),
  );
}

/**
 * The access state as one creator meets it.
 *
 * A creator who does not meet the entry's `accountGate` is
 * `account_type_gated` whatever our own state is: nothing we ship changes
 * their answer, and telling them to reconnect would be false. One who does
 * meet it — or an entry with no gate — gets our state.
 *
 * "Our state" is our configuration's, not their connection's: a connection
 * made before a scope was added does not hold it. Whether one connection
 * holds a scope is `resolveAnalyticsAccess`'s answer (publishing), from the
 * scopes recorded at its callback. And `authorised` is not "seen working" —
 * read `verified` / `pendingVerification` on the entry for that.
 */
export function accessFor(
  family: MetricFamily,
  platform: AnalyticsPlatform,
  creator: { meetsAccountGate: boolean },
): AccessState {
  const capability = capabilityFor(family, platform);

  return capability.accountGate && !creator.meetsAccountGate
    ? 'account_type_gated'
    : capability.access;
}

export interface CoverageCaveat {
  platform: AnalyticsPlatform;
  level: Exclude<SupportLevel, 'native'>;
  note: string;
}

export interface CoverageSummary {
  /** `native`. */
  measured: AnalyticsPlatform[];
  derived: AnalyticsPlatform[];
  /** `not_ingested` or `unsupported`; `caveats` says which, and why. */
  absent: AnalyticsPlatform[];
  /** One per selected platform that is not `native`, in platform order. */
  caveats: CoverageCaveat[];
}

/**
 * What a card showing `family` for `selectedPlatforms` can say about itself.
 * The one call a card makes. Static: this is capability, not whether rows
 * exist for a project in a window — that is FILM-1704, on a different path.
 */
export function coverageSummary(
  family: MetricFamily,
  selectedPlatforms: readonly AnalyticsPlatform[] = ANALYTICS_PLATFORMS,
): CoverageSummary {
  const summary: CoverageSummary = {
    measured: [],
    derived: [],
    absent: [],
    caveats: [],
  };

  for (const platform of ANALYTICS_PLATFORMS) {
    if (!selectedPlatforms.includes(platform)) continue;

    const { level, note } = capabilityFor(family, platform);

    if (level === 'native') {
      summary.measured.push(platform);
      continue;
    }

    (level === 'derived' ? summary.derived : summary.absent).push(platform);
    summary.caveats.push({ platform, level, note });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Observed coverage (FILM-1704). The matrix above says what a platform *can*
// report; this says what a project *has*, in one window. The query lives in
// `queries-advanced.ts` (`queryObservedCoverage`); the fold lives here so it
// is pure and testable without a database.
// ---------------------------------------------------------------------------

/**
 * The fact tables `queryObservedCoverage` reads, once each, in one
 * statement. A family read from any other table (`video_audience`,
 * `channel_subscribers`, `channel_windows`) gets no observed answer from it
 * — see `foldObservedCoverage`.
 */
export const OBSERVED_COVERAGE_TABLES = [
  'video_metrics',
  'video_traffic_sources',
  'video_reach_daily',
  'video_retention_curves',
  'channel_daily',
] as const satisfies readonly SourceTable[];

/** One (table, platform) answer from `queryObservedCoverage`. */
export interface ObservedCoverageRow {
  table: SourceTable;
  /**
   * `null` for a `channel_daily` row whose connection could not be resolved
   * to a platform: that table has no platform column, and a row is never
   * labelled `youtube` because that happens to be true today.
   */
  platform: string | null;
  rows: number;
  /**
   * Newest `metric_date` in the window. `video_retention_curves` has no
   * metric date — a curve is a video's lifetime — so for it this is the day
   * the newest curve was fetched.
   */
  latestDate: string | null;
  /** `metric_source` values seen; only `video_metrics` has the column. */
  metricSources: string[];
}

/**
 * Why a (family, platform) cell shows what it shows. Four kinds, from three
 * sources, never collapsed:
 *
 * - `unsupported` / `not_ingested` — the matrix: the platform can't, or we
 *   haven't. No query needed.
 * - `not_connected` — Postgres: no channel on that platform.
 * - `no_data_in_window` / `covered` — ClickHouse, in this window.
 */
export type CoverageState =
  | { kind: 'unsupported' | 'not_ingested'; note: string }
  | { kind: 'not_connected' }
  | { kind: 'no_data_in_window' }
  | { kind: 'covered'; rows: number; latestDate: string; stale: boolean };

/**
 * Every family × platform. `null` means *cannot measure*: ClickHouse was not
 * read, or the family's table is not one of `OBSERVED_COVERAGE_TABLES`. It
 * never means empty — empty is `no_data_in_window`.
 */
export type CoverageMatrix = Record<
  MetricFamily,
  Record<AnalyticsPlatform, CoverageState | null>
>;

/**
 * Days the newest row may trail the window's end before a covered cell is
 * `stale`. Defined once, here, and never per card.
 *
 * YouTube's reporting ingest lags one to three days by design, so a
 * threshold near that cries wolf about healthy ingest. A channel with no
 * activity can also go a few days without a row on a reporting table. Two
 * weeks is far enough past both that a stale flag means ingest stopped, and
 * close enough that six weeks of silence is caught well before anyone
 * reads it as a quiet channel.
 */
export const COVERAGE_STALE_AFTER_DAYS = 14;

/**
 * How far a day's data on a reporting surface — YouTube's bulk reports:
 * traffic sources, impressions, channel totals — trails the day it
 * describes, by design. The reason `COVERAGE_STALE_AFTER_DAYS` is generous,
 * and the one place a surface reads when it has to say when such figures
 * arrive (FILM-1705: the diagnostics table said "about two days" on its
 * own).
 */
export const REPORTING_LAG_DAYS = { min: 1, max: 3 } as const;

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/**
 * The day staleness is measured to: the window's end, or today when the
 * window runs past it. A March window whose newest row is 29 March is
 * healthy whatever today is — nothing after March was asked for.
 */
export function coverageAsOf(windowEnd: string, today: string): string {
  return windowEnd < today ? windowEnd : today;
}

export function isCoverageStale(latestDate: string, asOf: string): boolean {
  return dayNumber(asOf) - dayNumber(latestDate) > COVERAGE_STALE_AFTER_DAYS;
}

/**
 * The half of a cell the matrix answers alone, so it can render before any
 * query resolves. `null` where the platform can have data and only an
 * observation can say whether it does.
 */
export function capabilityCoverage(
  capability: PlatformCapability,
): CoverageState | null {
  return capability.level === 'unsupported' ||
    capability.level === 'not_ingested'
    ? { kind: capability.level, note: capability.note }
    : null;
}

function isObservedTable(table: SourceTable): boolean {
  return (OBSERVED_COVERAGE_TABLES as readonly SourceTable[]).includes(table);
}

/**
 * Folds `queryObservedCoverage`'s rows into a `CoverageMatrix`, per cell:
 *
 * 1. the matrix: `unsupported` / `not_ingested` need nothing observed;
 * 2. rows in the family's table for the platform → `covered`. Rows win over
 *    the connection list: a disconnected channel keeps its history, and a
 *    card showing that history must not be labelled "not connected";
 * 3. no connection on the platform → `not_connected`;
 * 4. connected, observed, no rows → `no_data_in_window`; and `null` where
 *    nothing was observed (`rows` is `null`, or the table is not one of the
 *    five).
 *
 * The table → family mapping is the matrix's `table`, so this module stays
 * the one place it is stated.
 */
export function foldObservedCoverage(
  rows: readonly ObservedCoverageRow[] | null,
  matrix: typeof CAPABILITY_MATRIX,
  context: {
    /** Platforms with a connection in scope, from `platform_connections`. */
    connectedPlatforms: readonly string[];
    /** See `coverageAsOf`. */
    asOf: string;
  },
): CoverageMatrix {
  const observed = new Map<
    string,
    { rows: number; latestDate: string | null }
  >();

  for (const row of rows ?? []) {
    // Unresolved: never guessed at.
    if (row.platform === null) continue;

    const key = `${row.table}:${row.platform}`;
    const seen = observed.get(key);
    const latestDate =
      seen?.latestDate && row.latestDate
        ? seen.latestDate > row.latestDate
          ? seen.latestDate
          : row.latestDate
        : (seen?.latestDate ?? row.latestDate);

    observed.set(key, { rows: (seen?.rows ?? 0) + row.rows, latestDate });
  }

  const cell = (
    capability: PlatformCapability,
    platform: AnalyticsPlatform,
  ): CoverageState | null => {
    const fromMatrix = capabilityCoverage(capability);

    if (fromMatrix) return fromMatrix;

    const table = capability.table;

    // Unreachable: a level with data always names its table.
    if (table === null) return null;

    const seen = observed.get(`${table}:${platform}`);

    if (seen && seen.rows > 0) {
      return seen.latestDate === null
        ? null
        : {
            kind: 'covered',
            rows: seen.rows,
            latestDate: seen.latestDate,
            stale: isCoverageStale(seen.latestDate, context.asOf),
          };
    }

    if (!context.connectedPlatforms.includes(platform)) {
      return { kind: 'not_connected' };
    }

    return rows === null || !isObservedTable(table)
      ? null
      : { kind: 'no_data_in_window' };
  };

  return Object.fromEntries(
    METRIC_FAMILIES.map((family) => [
      family,
      Object.fromEntries(
        ANALYTICS_PLATFORMS.map((platform) => [
          platform,
          cell(matrix[family][platform], platform),
        ]),
      ),
    ]),
  ) as CoverageMatrix;
}

/** Which `video_audience` dimensions answer each audience family. */
export const AUDIENCE_FAMILY_DIMENSIONS = {
  demographics: ['age_group', 'gender'],
  geography: ['country', 'city'],
  device: ['device', 'os'],
  follower_status: ['follower_status'],
} as const satisfies Partial<
  Record<MetricFamily, readonly AudienceDimension[]>
>;

/**
 * The `metric_source` values a `video_metrics` row may carry for a platform,
 * given what the matrix says about it.
 *
 * Reconciles with the notion of derivation the rows already record rather
 * than inventing a parallel one: a `reporting_api` row for a platform the
 * matrix calls `derived` means the matrix is wrong.
 */
export function allowedMetricSources(
  capability: PlatformCapability,
): readonly MetricSource[] {
  if (capability.level === 'native') {
    return ['analytics_api', 'reporting_api', 'backfill'];
  }

  if (
    capability.level === 'derived' &&
    capability.method === 'snapshot_delta_fetch_day'
  ) {
    return ['snapshot_delta'];
  }

  return [];
}

/**
 * The `metric_source` of a row dated to the day we fetched it rather than
 * the day it describes: a lifetime counter's change since the last check.
 */
export const FETCH_DATED_METRIC_SOURCE =
  'snapshot_delta' satisfies MetricSource;

/**
 * Whether a platform's daily views are fetch-dated (FILM-1707 §2).
 *
 * The rule the Deep Dive tab is built on: a fetch-dated figure never goes
 * on a date axis. Decided by how the matrix says the rows are dated, never
 * by a platform name, so a platform that starts supplying a true daily
 * series rejoins every date axis by changing its matrix entry alone.
 */
export function isFetchDated(platform: AnalyticsPlatform): boolean {
  return allowedMetricSources(capabilityFor('engagement', platform)).includes(
    FETCH_DATED_METRIC_SOURCE,
  );
}

/**
 * Platforms seen in a family's table that the matrix does not claim.
 *
 * A subset check, deliberately — a fresh fixture holds YouTube or nothing,
 * so equality would fail on every table it leaves empty. The matrix claims
 * what the pipeline *may* produce; this catches it producing more.
 */
export function unclaimedPlatforms(
  family: MetricFamily,
  observed: readonly string[],
): string[] {
  const claimed: readonly string[] = platformsWithData(family);

  return [...new Set(observed)].filter(
    (platform) => !claimed.includes(platform),
  );
}

// ---------------------------------------------------------------------------
// Bindings to the pipeline. Paths are repository-relative.
// ---------------------------------------------------------------------------

/** The one function that writes each table. */
export const TABLE_WRITERS: Record<SourceTable, string> = {
  video_metrics: 'insertVideoMetrics',
  video_traffic_sources: 'insertVideoTrafficSources',
  video_retention_curves: 'insertRetentionCurves',
  video_reach_daily: 'insertVideoReachDaily',
  video_revenue_daily: 'insertVideoRevenueDaily',
  channel_daily: 'insertChannelDaily',
  channel_reach_daily: 'insertChannelReachDaily',
  channel_subscribers: 'insertSubscriberSnapshot',
  channel_windows: 'insertChannelWindows',
  video_audience: 'insertVideoAudience',
};

const CONTENT_ANALYTICS = 'packages/features/content-analytics/src';
const SEED_SCRIPT = 'apps/web/scripts/seed-local-analytics.ts';
const VERIFY_SCRIPT = 'packages/clickhouse/scripts/verify-queries.ts';

/**
 * Every file that calls each table's writer — and the suite fails on a call
 * from any file not listed here.
 *
 * This is the load-bearing guard. A TikTok traffic-source writer added
 * anywhere in the monorepo turns CI red, and the only way to green it is to
 * edit this file, in the same pull request, with the matrix a screen above.
 * It binds to call sites rather than to `platform:` literals, which would
 * stop working the day someone passes a variable.
 */
export const WRITER_CALL_SITES: Record<SourceTable, readonly string[]> = {
  video_metrics: [
    SEED_SCRIPT,
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/analytics-sync-cron.ts`,
    `${CONTENT_ANALYTICS}/server/backfill/youtube-backfill.ts`,
    `${CONTENT_ANALYTICS}/server/reporting/report-ingest.ts`,
  ],
  video_traffic_sources: [
    SEED_SCRIPT,
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/reporting/report-ingest.ts`,
  ],
  video_retention_curves: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/analytics-sync-cron.ts`,
  ],
  video_reach_daily: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/reporting/report-ingest.ts`,
  ],
  video_revenue_daily: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/analytics-sync-cron.ts`,
  ],
  channel_daily: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/reporting/report-ingest.ts`,
  ],
  channel_reach_daily: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/reporting/report-ingest.ts`,
  ],
  channel_subscribers: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/subscriber-snapshot.ts`,
  ],
  channel_windows: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/channel-reach-windows.ts`,
  ],
  video_audience: [
    VERIFY_SCRIPT,
    `${CONTENT_ANALYTICS}/server/analytics-sync-cron.ts`,
  ],
};

/**
 * Text whose presence in the code means an absent entry has stopped being
 * absent.
 *
 * `WRITER_CALL_SITES` cannot see a family that shares a table: Instagram
 * watch time would arrive through the `insertVideoMetrics` call that is
 * already listed. What does change is the request — so each entry here names
 * the literal that starting to collect the data has to introduce, and the
 * suite asserts presence and matrix agree, both ways. Requesting the field
 * without moving the entry fails; moving the entry without requesting it
 * fails.
 *
 * - `requested`  — present iff the level is `native` or `derived`
 * - `authorised` — present iff `access` is no longer `scope_missing`
 */
export interface IngestionMarker {
  family: MetricFamily;
  platform: AnalyticsPlatform;
  /** A file or a directory, searched recursively. */
  within: string;
  marker: string;
  proves: 'requested' | 'authorised';
}

export const INGESTION_MARKERS: readonly IngestionMarker[] = [
  {
    family: 'watch_time',
    platform: 'instagram',
    within: `${CONTENT_ANALYTICS}/providers/instagram`,
    marker: 'ig_reels_video_view_total_time',
    proves: 'requested',
  },
  {
    family: 'revenue',
    platform: 'youtube',
    within: 'packages/features/publishing/src/oauth/youtube',
    marker: 'yt-analytics-monetary.readonly',
    proves: 'authorised',
  },
  // One host for everything on TikTok's Business API.
  ...(['watch_time', 'traffic_sources', 'reach', 'geography'] as const).map(
    (family): IngestionMarker => ({
      family,
      platform: 'tiktok',
      within: `${CONTENT_ANALYTICS}/providers/tiktok`,
      marker: 'business-api.tiktok.com',
      proves: 'requested',
    }),
  ),
];
