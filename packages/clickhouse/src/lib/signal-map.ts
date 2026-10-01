/**
 * The signal model (FILM-1714).
 *
 * No engagement rate works on every platform. Each platform counts a
 * valuable viewer differently, so each weights the funnel differently. The
 * funnel itself is the same everywhere, though. So the stages are defined
 * once, here, and only which signal fills a stage changes per platform and
 * per format.
 *
 * Keep these four distinctions apart. Each one is a single careless rename
 * away from merging into another:
 *
 * - **unbound vs dark.** An unbound stage has no honest signal on this
 *   platform, and never will: "Instagram reports no follows for a Reel".
 *   A dark stage is bound to a signal whose input we have not ingested yet:
 *   that is a ticket. Both look empty on screen, but only dark belongs in a
 *   backlog.
 * - **support vs composition.** `SupportLevel.derived` means "ingested as
 *   a snapshot delta". `composition: 'ratio'` means "we divide two
 *   figures". A share rate on YouTube is a ratio, and it is `native`
 *   because both of its inputs are native. Treating one axis as the other
 *   corrupts FILM-1703's vocabulary.
 * - **primary vs supporting.** The primary says whether a stage is weak.
 *   The supporting signals say why.
 * - **computed vs authored support.** A signal has no storage, so it cannot
 *   fill a `PlatformCapability`. It declares its input families and inherits
 *   the weakest of their levels. Nothing here is added to
 *   `CAPABILITY_MATRIX`.
 *
 * Pure and client-safe, like the rest of `lib/`.
 */
import type { AnalyticsPlatform } from '../types';
import type { MetricFamily, SupportLevel } from './data-provenance';
import { CAPABILITY_MATRIX, weakestSupport } from './data-provenance';
import type { FormatFamily } from './format-families';

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The funnel, in order. The stages are the same on every platform.
 *
 * **Adding a stage** (FILM-1726 added the sixth, `monetisation`, after
 * `audience`): append it here. Then:
 *
 * - `FUNNEL_STAGE_QUESTION` and every `SIGNAL_MAP` cell stop compiling
 *   until each platform × format binds the new stage, or leaves it unbound
 *   with a reason.
 * - `signal-map.test.ts` fails on the same cells.
 *
 * A consumer should iterate `FUNNEL_STAGES`, or use `stageReadings`, rather
 * than spell out the six. Then a seventh stage needs no change outside this
 * file. A consumer that keeps a `Record<FunnelStage, …>` stops compiling
 * instead, which is the point.
 *
 * Monetisation is last because it is an outcome of the funnel, not a step
 * a viewer takes inside it. It is a stage because the owner decided so
 * (FILM-1726, 2026-10-01). The earlier reason for leaving it out was that
 * revenue is unmeasurable, and that was wrong: YouTube revenue was gated by
 * a scope we had not asked for. Like every other stage, it may be unbound
 * where the platform reports nothing.
 */
export const FUNNEL_STAGES = [
  'reach',
  'hook',
  'attention',
  'transmission',
  'audience',
  'monetisation',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** The question each stage answers, in the creator's words. */
export const FUNNEL_STAGE_QUESTION: Record<FunnelStage, string> = {
  reach: 'Did the platform show it?',
  hook: 'Did they stop or click?',
  attention: 'Did they keep watching?',
  transmission: 'Did they pass it on?',
  audience: 'Did they come back or follow?',
  monetisation: 'Did it earn?',
};

export const FUNNEL_STAGE_LABEL: Record<FunnelStage, string> = {
  reach: 'Reach',
  hook: 'Hook',
  attention: 'Attention',
  transmission: 'Transmission',
  audience: 'Audience',
  monetisation: 'Monetisation',
};

/** FILM-1716's format families: the inner key of the map. */
export type PublishFormat = FormatFamily;

// ---------------------------------------------------------------------------
// Signals: platform-agnostic definitions
// ---------------------------------------------------------------------------

/**
 * How a signal's value is computed. This says nothing about how its inputs
 * are ingested; `SupportLevel` says that.
 *
 * - `measured`     the platform reports the figure itself
 * - `ratio`        we divide one reported figure by another
 * - `interpolated` we read a point off a reported series, such as one
 *                  point of a retention curve
 */
export type SignalComposition = 'measured' | 'ratio' | 'interpolated';

export const SIGNAL_IDS = [
  'impressions',
  'traffic_source_mix',
  'accounts_reached',
  'views_per_follower',
  'impressions_ctr',
  'play_rate',
  'first_30s_retention',
  'first_3s_retention',
  'average_view_duration',
  'average_percentage_viewed',
  'audience_retention',
  'full_video_watched_rate',
  'ig_reels_avg_watch_time',
  'reels_skip_rate',
  'quartile_retention',
  'share_rate',
  'comment_rate',
  'shares_per_reach',
  'saves_per_reach',
  'comments_per_reach',
  'reposts_per_reach',
  'repost_rate',
  'subscriber_conversion',
  'subscriber_view_share',
  // Facebook (FILM-1720): its own denominators, each named for what it divides by.
  'media_views',
  'click_to_play_share',
  'watch_time_per_play',
  'watch_time_per_3s_view',
  'complete_view_rate',
  'follows_per_reach',
  // Monetisation (FILM-1726): the platform's own estimate, never a figure
  // a person typed in, which lives in Postgres with its currency.
  'estimated_revenue',
  'revenue_per_mille',
  'ad_break_cpm',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

/**
 * A vendor field whose unit the vendor does not document. The figure is
 * withheld until someone has seen the unit in a live response. A 1000×
 * error from reading milliseconds as seconds is silent and looks plausible,
 * and so is a 100× one from reading a 0–1 fraction as a percentage.
 */
type SignalUnit = 'milliseconds' | 'seconds' | 'percent';

export type SignalUnitCheck =
  | {
      unit: SignalUnit;
      confirmed: { on: string; how: string };
      pending?: undefined;
    }
  | {
      unit: SignalUnit;
      confirmed?: undefined;
      /** Who confirms it: a spec id, or `'owner'`. Becomes the blocker. */
      pending: { owner: string; question: string };
    };

export interface SignalDefinition {
  id: SignalId;
  /** The one stage this signal answers. A binding in any other stage fails. */
  stage: FunnelStage;
  /** Non-empty, by type. Support is the weakest of these, at read time. */
  inputs: readonly [MetricFamily, ...MetricFamily[]];
  composition: SignalComposition;
  /** Creator-facing, one sentence, in FILM-1703's note style. */
  definition: string;
  unitCheck?: SignalUnitCheck;
}

export const SIGNALS: Record<SignalId, SignalDefinition> = {
  impressions: {
    id: 'impressions',
    stage: 'reach',
    inputs: ['reach'],
    composition: 'measured',
    definition: 'How many times the platform showed the video’s thumbnail.',
  },
  traffic_source_mix: {
    id: 'traffic_source_mix',
    stage: 'reach',
    inputs: ['traffic_sources'],
    composition: 'measured',
    definition:
      'Where the views came from: search, suggestions, browse features and the rest.',
  },
  accounts_reached: {
    id: 'accounts_reached',
    stage: 'reach',
    inputs: ['accounts_reached'],
    composition: 'measured',
    definition:
      'How many different accounts saw the video, each counted once however often they saw it.',
  },
  views_per_follower: {
    id: 'views_per_follower',
    stage: 'reach',
    inputs: ['engagement', 'channel_totals'],
    composition: 'ratio',
    definition:
      'Views divided by your follower count: how far past your own audience the video travelled.',
  },
  impressions_ctr: {
    id: 'impressions_ctr',
    stage: 'hook',
    inputs: ['reach'],
    composition: 'measured',
    definition:
      'Of the times the thumbnail was shown, the share that someone clicked.',
  },
  play_rate: {
    id: 'play_rate',
    stage: 'hook',
    inputs: ['reach', 'retention_curve'],
    composition: 'ratio',
    definition:
      'Of the times the post was shown, the share in which its video started playing.',
  },
  first_30s_retention: {
    id: 'first_30s_retention',
    stage: 'hook',
    inputs: ['retention_curve'],
    composition: 'interpolated',
    definition:
      'The share of the audience still watching 30 seconds in, read off the retention curve.',
  },
  first_3s_retention: {
    id: 'first_3s_retention',
    stage: 'hook',
    inputs: ['retention_curve'],
    composition: 'interpolated',
    definition:
      'The share of the audience still watching 3 seconds in, read off the retention curve.',
  },
  average_view_duration: {
    id: 'average_view_duration',
    stage: 'attention',
    inputs: ['watch_time'],
    composition: 'measured',
    definition: 'How long a view lasted, on average.',
  },
  average_percentage_viewed: {
    id: 'average_percentage_viewed',
    stage: 'attention',
    inputs: ['watch_time'],
    composition: 'measured',
    definition: 'How much of the video a view covered, on average.',
  },
  audience_retention: {
    id: 'audience_retention',
    stage: 'attention',
    inputs: ['retention_curve'],
    composition: 'measured',
    definition:
      'How much of the audience was still watching at each point through the video.',
  },
  full_video_watched_rate: {
    id: 'full_video_watched_rate',
    stage: 'attention',
    inputs: ['watch_time'],
    composition: 'measured',
    definition: 'The share of views that watched to the end.',
  },
  // Not `average_view_duration` under another name. Meta does not divide by
  // views: one Reel read 749,526 ms total over 221 views with an average of
  // 6,194, and 749,526 ÷ 6,194 is 121 (FILM-1712). Folding the two together
  // would put one platform's figure beside another that is a different
  // quotient.
  ig_reels_avg_watch_time: {
    id: 'ig_reels_avg_watch_time',
    stage: 'attention',
    inputs: ['watch_time'],
    composition: 'measured',
    definition:
      'How long a Reel was played, on average, as Instagram reports it. Instagram divides by its own count, not by views.',
    unitCheck: {
      unit: 'milliseconds',
      confirmed: {
        on: '2026-09-29',
        how: 'the owner’s own Instagram business account: Meta’s response titles the metric “(milliseconds)”, and a Reel with 221 views read 6,194 — 6.2 seconds (FILM-1712)',
      },
    },
  },
  // Arguably a Hook signal: it measures the first three seconds. It is bound
  // under Attention because FILM-1714 says so (the Instagram Attention
  // criterion). Instagram has no other early-drop figure, so Instagram's Hook
  // is unbound rather than this signal being counted in two stages.
  reels_skip_rate: {
    id: 'reels_skip_rate',
    stage: 'attention',
    inputs: ['watch_time'],
    composition: 'measured',
    definition:
      'The share of a Reel’s views from people who skipped it within the first 3 seconds.',
    // Stored as reported since KB-151. Meta calls it a percentage but shows
    // no value, so whether 25% arrives as 25 or 0.25 is unknown until a live
    // response is read, as FILM-1712 read the watch-time unit.
    unitCheck: {
      unit: 'percent',
      pending: {
        owner: 'owner',
        question:
          'Does reels_skip_rate arrive as a percentage (0–100) or a fraction (0–1)? Read one live Reel’s value beside what Instagram’s app shows for it.',
      },
    },
  },
  // Not `audience_retention` under another name. X counts how many plays
  // reached each quarter of the video, so its five points are shares of
  // plays started; YouTube's curve is a share of views at a hundred points.
  // Folding the two together would put one quotient beside another.
  quartile_retention: {
    id: 'quartile_retention',
    stage: 'attention',
    inputs: ['retention_curve'],
    composition: 'ratio',
    definition:
      'Of the plays that started, the share that reached a quarter, half, three quarters and the end of the video.',
  },
  share_rate: {
    id: 'share_rate',
    stage: 'transmission',
    inputs: ['engagement'],
    composition: 'ratio',
    definition: 'Shares per view.',
  },
  comment_rate: {
    id: 'comment_rate',
    stage: 'transmission',
    inputs: ['engagement'],
    composition: 'ratio',
    definition: 'Comments per view.',
  },
  shares_per_reach: {
    id: 'shares_per_reach',
    stage: 'transmission',
    inputs: ['engagement', 'accounts_reached'],
    composition: 'ratio',
    definition: 'Shares per account reached.',
  },
  saves_per_reach: {
    id: 'saves_per_reach',
    stage: 'transmission',
    inputs: ['engagement', 'accounts_reached'],
    composition: 'ratio',
    definition: 'Saves per account reached.',
  },
  comments_per_reach: {
    id: 'comments_per_reach',
    stage: 'transmission',
    inputs: ['engagement', 'accounts_reached'],
    composition: 'ratio',
    definition: 'Comments per account reached.',
  },
  reposts_per_reach: {
    id: 'reposts_per_reach',
    stage: 'transmission',
    inputs: ['reposts', 'accounts_reached'],
    composition: 'ratio',
    definition: 'Reposts per account reached.',
  },
  repost_rate: {
    id: 'repost_rate',
    stage: 'transmission',
    inputs: ['reposts', 'engagement'],
    composition: 'ratio',
    definition: 'Reposts per view.',
  },
  subscriber_conversion: {
    id: 'subscriber_conversion',
    stage: 'audience',
    inputs: ['engagement', 'channel_totals'],
    composition: 'ratio',
    definition: 'Subscribers gained per view.',
  },
  subscriber_view_share: {
    id: 'subscriber_view_share',
    stage: 'audience',
    inputs: ['follower_status'],
    composition: 'ratio',
    definition:
      'The share of views that came from people already subscribed. This is not new viewers against returning ones.',
  },
  // Facebook's impression replacement since Graph v26.0. A count of plays
  // and displays, not of people: never a denominator beside a YouTube view.
  media_views: {
    id: 'media_views',
    stage: 'reach',
    inputs: ['reach'],
    composition: 'measured',
    definition:
      'How many times Facebook played or showed the video, as Facebook counts it.',
  },
  // An intent split no other platform here offers: neither half is "views".
  click_to_play_share: {
    id: 'click_to_play_share',
    stage: 'hook',
    inputs: ['engagement'],
    composition: 'ratio',
    definition:
      'Of the plays that lasted 3 seconds, the share that started because someone clicked play rather than because it played by itself.',
  },
  // Not `average_view_duration`, and not Facebook's own average: the time
  // includes replays and the plays do not, so it can exceed the video's
  // length. Divided here, so the denominator is ours to name.
  watch_time_per_play: {
    id: 'watch_time_per_play',
    stage: 'attention',
    inputs: ['watch_time', 'engagement'],
    composition: 'ratio',
    definition:
      'Time watched, replays included, divided by first plays. It can be longer than the reel itself, because replays add time but not plays.',
  },
  watch_time_per_3s_view: {
    id: 'watch_time_per_3s_view',
    stage: 'attention',
    inputs: ['watch_time', 'engagement'],
    composition: 'ratio',
    definition:
      'Time watched divided by the plays that lasted at least 3 seconds. Plays shorter than that add time but are not counted.',
  },
  complete_view_rate: {
    id: 'complete_view_rate',
    stage: 'attention',
    inputs: ['engagement'],
    composition: 'ratio',
    definition:
      'Of the plays that lasted 3 seconds, the share that reached 97% of the video.',
  },
  follows_per_reach: {
    id: 'follows_per_reach',
    stage: 'audience',
    inputs: ['engagement', 'accounts_reached'],
    composition: 'ratio',
    definition:
      'Follows Facebook credits to the reel, per person who viewed it.',
  },
  // The platform's estimate, in US dollars: ClickHouse holds no other
  // currency (KB-12). A creator's own entries are on the Revenue tab, beside
  // their currency, and never fill this stage.
  estimated_revenue: {
    id: 'estimated_revenue',
    stage: 'monetisation',
    inputs: ['revenue'],
    composition: 'measured',
    definition:
      'What the platform estimates the video earned, in US dollars, before any deal or sponsorship you enter yourself.',
  },
  // YouTube's RPM, divided here so the denominator is ours to name: views
  // in this table's sense, not YouTube's monetised playbacks.
  revenue_per_mille: {
    id: 'revenue_per_mille',
    stage: 'monetisation',
    inputs: ['revenue', 'engagement'],
    composition: 'ratio',
    definition:
      'Estimated earnings per thousand views: whether the video earned well for how many watched it.',
  },
  // What advertisers paid, not what the creator kept: a supporting signal
  // that says whether a weak stage is low demand or few ad breaks.
  ad_break_cpm: {
    id: 'ad_break_cpm',
    stage: 'monetisation',
    inputs: ['revenue'],
    composition: 'measured',
    definition:
      'What advertisers paid per thousand ad impressions in the video’s ad breaks, as Facebook reports it.',
  },
};

// ---------------------------------------------------------------------------
// Input gaps: a vendor field the family level cannot see
// ---------------------------------------------------------------------------

const CONTENT_ANALYTICS = 'packages/features/content-analytics/src';

/**
 * Where a family is ingested on a platform but the one field a signal reads
 * is not. Read at the family level, such a signal would claim a figure
 * nobody stores. (Instagram's average watch time and skip rate were the
 * first two, until KB-151 stored them.)
 *
 * A gap can only make support weaker, and only to `not_ingested`. It never
 * makes support stronger, and it is never written into
 * `CAPABILITY_MATRIX`. Two rules in `signal-map.test.ts` keep each gap
 * true:
 *
 * - **Stale.** `marker` is the literal that collecting the field has to
 *   introduce under `within`. Once the marker is present, the gap fails
 *   until someone removes it.
 * - **Redundant.** A gap on a signal whose families are already this weak
 *   or weaker says nothing, so it fails.
 */
export interface SignalInputGap {
  signal: SignalId;
  platform: AnalyticsPlatform;
  /** The vendor field the signal needs. */
  field: string;
  /** A spec or KB id: what has to ship before the gap closes. */
  blockedBy: string;
  /** Creator-facing: why the figure is missing. */
  note: string;
  /** A file or directory, searched recursively. */
  within: string;
  marker: string;
}

// KB-151 stored Instagram's average watch time and skip rate, closing the
// two gaps it held; X's shares are the one field-level gap left.
export const SIGNAL_INPUT_GAPS: readonly SignalInputGap[] = [
  {
    // `engagement` is ingested for X, but its `shares` column is NULL on
    // every X row (migration 021): shares are on the Enterprise endpoint.
    signal: 'share_rate',
    platform: 'twitter',
    field: 'shares',
    blockedBy: 'FILM-1727',
    note: 'X reports how often a post was shared only on its Enterprise plan, which we do not hold, so no X share rate is shown.',
    within: `${CONTENT_ANALYTICS}/providers/twitter`,
    marker: 'tweets/analytics',
  },
];

// ---------------------------------------------------------------------------
// Support, computed
// ---------------------------------------------------------------------------

/** One input family as the matrix states it for one platform. */
export interface SignalInputSupport {
  family: MetricFamily;
  level: SupportLevel;
  /** The spec that would make it `native`, when the level is `not_ingested`. */
  blockedBy: string | null;
  /** The matrix entry's note, verbatim. */
  note: string;
}

/**
 * What a signal can be on one platform, with every input listed and not
 * just the weakest one. When a two-input signal's weakest level is
 * `derived`, the reader still needs to know which half is soft.
 */
export interface SignalSupport {
  signal: SignalId;
  platform: AnalyticsPlatform;
  /** The weakest of the inputs, then of the gap and the unit check. */
  level: SupportLevel;
  composition: SignalComposition;
  inputs: readonly SignalInputSupport[];
  gap: SignalInputGap | null;
  /** Set when the unit has not been confirmed: the figure is withheld. */
  unitPending: { owner: string; question: string } | null;
  /** The distinct ids that have to ship before this signal has a figure. */
  blockers: readonly string[];
}

/**
 * Support for `definition` on `platform`. It takes the definition and the
 * gaps as parameters so a test can feed it cases the real map does not hold.
 */
export function computeSignalSupport(
  definition: SignalDefinition,
  platform: AnalyticsPlatform,
  gaps: readonly SignalInputGap[] = SIGNAL_INPUT_GAPS,
): SignalSupport {
  const inputs = definition.inputs.map((family): SignalInputSupport => {
    const capability = CAPABILITY_MATRIX[family][platform];

    return {
      family,
      level: capability.level,
      blockedBy:
        capability.level === 'not_ingested' ? capability.blockedBy : null,
      note: capability.note,
    };
  });

  const gap =
    gaps.find(
      (candidate) =>
        candidate.signal === definition.id && candidate.platform === platform,
    ) ?? null;

  const unitPending = definition.unitCheck?.pending ?? null;

  const [first, ...rest] = inputs.map((input) => input.level);
  const level = weakestSupport([
    first!,
    ...rest,
    ...(gap || unitPending ? (['not_ingested'] as const) : []),
  ]);

  const blockers = [
    ...new Set(
      [
        ...inputs.map((input) => input.blockedBy),
        gap?.blockedBy ?? null,
        unitPending?.owner ?? null,
      ].filter((id): id is string => id !== null),
    ),
  ];

  return {
    signal: definition.id,
    platform,
    level,
    composition: definition.composition,
    inputs,
    gap,
    unitPending,
    blockers,
  };
}

export function signalSupport(
  signal: SignalId,
  platform: AnalyticsPlatform,
): SignalSupport {
  return computeSignalSupport(SIGNALS[signal], platform);
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/**
 * Why a stage has no signal. Every reason is a fact about the platform or
 * the format, never about our backlog. A gap in our backlog binds the stage
 * and shows it as dark.
 */
export type UnboundReason =
  | 'platform_does_not_expose_an_impression_equivalent'
  | 'platform_does_not_expose_a_hook_measure'
  | 'platform_does_not_expose_per_video_follows'
  | 'platform_does_not_expose_revenue'
  | 'format_not_published_on_platform';

/** A figure that would help but which nobody can supply. Named, so the gap stays visible. */
export interface UnavailableSignal {
  name: string;
  /** Creator-facing: why there is none. */
  note: string;
}

export type StageBinding =
  | {
      primary: SignalId;
      supporting: readonly SignalId[];
      unavailable: readonly UnavailableSignal[];
    }
  // The note is required exactly when the stage is unbound.
  | { primary: null; reason: UnboundReason; note: string };

export type FormatStageMap = Record<FunnelStage, StageBinding>;

function bound(
  primary: SignalId,
  supporting: readonly SignalId[] = [],
  unavailable: readonly UnavailableSignal[] = [],
): StageBinding {
  return { primary, supporting, unavailable };
}

function unbound(reason: UnboundReason, note: string): StageBinding {
  return { primary: null, reason, note };
}

/** Every stage unbound: no publish on the platform is in this format. */
function notPublished(platform: string, format: string): FormatStageMap {
  const binding = unbound(
    'format_not_published_on_platform',
    `Nothing published to ${platform} is a ${format}, so this format has no signals there.`,
  );

  return {
    reach: binding,
    hook: binding,
    attention: binding,
    transmission: binding,
    audience: binding,
    monetisation: binding,
  };
}

const NO_SAVES_YOUTUBE: UnavailableSignal = {
  name: 'saves',
  note: 'YouTube does not report saves.',
};

/**
 * Unbound on purpose, not dark: whatever we build, the platform reports
 * nothing to read. What a creator types in on the Revenue tab is not a
 * substitute. That figure is theirs and not the platform's, and binding it
 * would make "unbound" stop meaning "unmeasurable" (FILM-1726).
 */
function noRevenue(platform: string): StageBinding {
  return unbound(
    'platform_does_not_expose_revenue',
    `${platform} does not report what a video earned, so there is no figure for this stage. What you enter yourself is on the Revenue tab.`,
  );
}

const YOUTUBE_PLAYER_MONETISATION = bound('revenue_per_mille', [
  'estimated_revenue',
]);

/**
 * YouTube's player formats. A teaser and a trailer are their own families
 * (FILM-1716): they exist to send viewers to something else. No platform
 * reports whether they did that, so that question is not in the map, and
 * their stages read like any other video's.
 */
const YOUTUBE_PLAYER: FormatStageMap = {
  reach: bound('impressions', ['traffic_source_mix']),
  hook: bound('impressions_ctr', ['first_30s_retention']),
  attention: bound('average_view_duration', [
    'average_percentage_viewed',
    'audience_retention',
  ]),
  transmission: bound('share_rate', ['comment_rate'], [NO_SAVES_YOUTUBE]),
  audience: bound('subscriber_conversion', ['subscriber_view_share']),
  monetisation: YOUTUBE_PLAYER_MONETISATION,
};

const YOUTUBE_SHORT: FormatStageMap = {
  reach: unbound(
    'platform_does_not_expose_an_impression_equivalent',
    'YouTube does not report how often a Short was shown in the Shorts feed, and thumbnail impressions do not count it, so a Short has no reach figure.',
  ),
  hook: bound(
    'first_3s_retention',
    [],
    [
      {
        name: 'stayed to watch',
        note: 'YouTube shows how many viewers stayed to watch a Short only in YouTube Studio, not through any API.',
      },
    ],
  ),
  attention: bound('average_view_duration', [
    'average_percentage_viewed',
    'audience_retention',
  ]),
  transmission: bound('share_rate', ['comment_rate'], [NO_SAVES_YOUTUBE]),
  audience: bound('subscriber_conversion', ['subscriber_view_share']),
  monetisation: bound(
    'estimated_revenue',
    [],
    [
      {
        name: 'earnings per thousand views',
        note: 'YouTube pays Shorts from a pool shared out by views, so a Short’s earnings per thousand views mostly restate the pool’s rate rather than anything about the Short.',
      },
    ],
  ),
};

/** TikTok's feed is the same full-screen surface whatever the length. */
const TIKTOK_FEED: FormatStageMap = {
  reach: bound('accounts_reached', ['views_per_follower']),
  hook: unbound(
    'platform_does_not_expose_a_hook_measure',
    'TikTok reports no impressions and no early-retention point on any API, so whether viewers stopped scrolling cannot be measured.',
  ),
  attention: bound(
    'average_view_duration',
    ['full_video_watched_rate'],
    [
      {
        name: 'retention curve',
        note: 'TikTok does not report a retention curve on any of its APIs.',
      },
    ],
  ),
  transmission: bound(
    'share_rate',
    ['comment_rate'],
    [
      {
        name: 'saves',
        note: 'TikTok does not report saves through any API open to us.',
      },
    ],
  ),
  audience: unbound(
    'platform_does_not_expose_per_video_follows',
    'TikTok does not report how many people followed you from a video.',
  ),
  monetisation: noRevenue('TikTok'),
};

/** Every Instagram video is a Reel since the 2022 unification. */
const INSTAGRAM_REELS: FormatStageMap = {
  reach: bound('accounts_reached', ['views_per_follower']),
  hook: unbound(
    'platform_does_not_expose_a_hook_measure',
    'Instagram reports no impressions or click-through. Its one early-drop figure, the share of views skipped in the first 3 seconds, is read under Attention.',
  ),
  attention: bound(
    'ig_reels_avg_watch_time',
    ['reels_skip_rate'],
    [
      {
        name: 'average percentage viewed',
        note: 'Instagram reports no completion rate, so how much of a Reel a view covered cannot be known.',
      },
      {
        name: 'retention curve',
        note: 'Instagram does not report a retention curve.',
      },
    ],
  ),
  transmission: bound('shares_per_reach', [
    'saves_per_reach',
    'comments_per_reach',
    'reposts_per_reach',
  ]),
  audience: unbound(
    'platform_does_not_expose_per_video_follows',
    'Instagram reports follows from feed posts and Stories but not from Reels, so who followed you from a Reel cannot be known.',
  ),
  monetisation: noRevenue('Instagram'),
};

const NO_IMPRESSIONS_FACEBOOK: UnavailableSignal = {
  name: 'impressions',
  note: 'Facebook stopped reporting how often a video was shown, and how many people saw it, with Graph API v26.0 in 2026.',
};

const FACEBOOK_OWN_AVERAGE: UnavailableSignal = {
  name: 'average time watched, as Facebook reports it',
  note: 'Facebook’s own average counts replay time but divides by first plays, so it can run longer than the video and is not comparable to an average view duration; we divide the totals ourselves instead.',
};

const NO_SAVES_FACEBOOK: UnavailableSignal = {
  name: 'saves',
  note: 'Facebook does not report saves for a video.',
};

/**
 * Ad-break earnings, Facebook's own revenue surface. No per-view rate:
 * Facebook has no single view to divide by (FILM-1722).
 */
const FACEBOOK_MONETISATION = bound(
  'estimated_revenue',
  ['ad_break_cpm'],
  [
    {
      name: 'earnings per thousand views',
      note: 'Facebook has no single count of views to divide earnings by, so only the earnings and what advertisers paid are shown.',
    },
  ],
);

/**
 * Facebook Reels: every short, teaser and trailer published there. Bound to
 * Facebook's own denominators (FILM-1720), none of which is a view in
 * YouTube's sense, so no signal here divides by views.
 */
const FACEBOOK_REELS: FormatStageMap = {
  reach: bound('accounts_reached', ['media_views'], [NO_IMPRESSIONS_FACEBOOK]),
  hook: bound('click_to_play_share'),
  attention: bound(
    'watch_time_per_play',
    ['complete_view_rate', 'audience_retention'],
    [FACEBOOK_OWN_AVERAGE],
  ),
  transmission: bound(
    'shares_per_reach',
    ['comments_per_reach'],
    [NO_SAVES_FACEBOOK],
  ),
  audience: bound('follows_per_reach'),
  monetisation: FACEBOOK_MONETISATION,
};

/** A Facebook video in the player: the Reels-only figures are absent. */
const FACEBOOK_PLAYER: FormatStageMap = {
  reach: bound('accounts_reached', ['media_views'], [NO_IMPRESSIONS_FACEBOOK]),
  hook: bound('click_to_play_share'),
  attention: bound(
    'watch_time_per_3s_view',
    ['complete_view_rate', 'audience_retention'],
    [
      FACEBOOK_OWN_AVERAGE,
      {
        name: 'plays',
        note: 'Facebook counts first plays and replays for reels only, so a video in the player is divided by its 3-second plays.',
      },
    ],
  ),
  transmission: bound(
    'shares_per_reach',
    ['comments_per_reach'],
    [NO_SAVES_FACEBOOK],
  ),
  audience: unbound(
    'platform_does_not_expose_per_video_follows',
    'Facebook credits follows to reels only, so who followed you from a video in the player cannot be known.',
  ),
  monetisation: FACEBOOK_MONETISATION,
};

/**
 * X's timeline (FILM-1727), on the pay-per-use tier. X is not primarily a
 * video recommender: it is a timeline someone scrolls past, so Transmission
 * reads its conversation (reposts, replies) and Attention its five playback
 * quartiles. Reach, Hook and Audience are bound and dark — X reports
 * impressions and, on Enterprise, follows per post; we store neither yet.
 */
const X_TIMELINE: FormatStageMap = {
  reach: bound('impressions'),
  hook: bound('play_rate'),
  attention: bound(
    'quartile_retention',
    [],
    [
      {
        name: 'average view duration',
        note: 'X reports watch time only on its Enterprise plan, so how long a play lasted cannot be shown.',
      },
    ],
  ),
  transmission: bound('repost_rate', ['comment_rate', 'share_rate']),
  audience: bound('subscriber_conversion'),
};

/**
 * Every platform × format × stage, with no defaults. The type rejects a
 * missing cell. `signal-map.test.ts` rejects a cell that claims more than
 * the matrix grants.
 *
 * Format is an inner key rather than a second table. Two tables would mean
 * two structural tests and a join at every read.
 */
export const SIGNAL_MAP: Record<
  AnalyticsPlatform,
  Record<PublishFormat, FormatStageMap>
> = {
  youtube: {
    short_vertical: YOUTUBE_SHORT,
    // A YouTube `short` over 180 seconds is served as an ordinary video.
    long_vertical: YOUTUBE_PLAYER,
    long_horizontal: YOUTUBE_PLAYER,
    teaser: YOUTUBE_PLAYER,
    trailer: YOUTUBE_PLAYER,
    clip: notPublished('YouTube', 'timeline clip'),
    live: notPublished('YouTube', 'live stream'),
  },
  tiktok: {
    short_vertical: TIKTOK_FEED,
    long_vertical: TIKTOK_FEED,
    long_horizontal: notPublished('TikTok', 'horizontal long-form video'),
    teaser: TIKTOK_FEED,
    trailer: TIKTOK_FEED,
    clip: notPublished('TikTok', 'timeline clip'),
    live: notPublished('TikTok', 'live stream'),
  },
  instagram: {
    short_vertical: INSTAGRAM_REELS,
    long_vertical: INSTAGRAM_REELS,
    long_horizontal: notPublished('Instagram', 'horizontal long-form video'),
    teaser: INSTAGRAM_REELS,
    trailer: INSTAGRAM_REELS,
    clip: notPublished('Instagram', 'timeline clip'),
    live: notPublished('Instagram', 'live stream'),
  },
  facebook: {
    short_vertical: FACEBOOK_REELS,
    long_vertical: notPublished('Facebook', 'vertical long-form video'),
    long_horizontal: FACEBOOK_PLAYER,
    teaser: FACEBOOK_REELS,
    trailer: FACEBOOK_REELS,
    clip: notPublished('Facebook', 'timeline clip'),
    live: notPublished('Facebook', 'live stream'),
  },
  // FILM-1716: X's `full` is horizontal and its `short` is a timeline clip.
  twitter: {
    short_vertical: notPublished('X', 'vertical short'),
    long_vertical: notPublished('X', 'vertical long-form video'),
    long_horizontal: X_TIMELINE,
    teaser: X_TIMELINE,
    trailer: X_TIMELINE,
    clip: X_TIMELINE,
    live: notPublished('X', 'live stream'),
  },
};

// ---------------------------------------------------------------------------
// Reading a stage
// ---------------------------------------------------------------------------

export type StageReading =
  | {
      stage: FunnelStage;
      status: 'unbound';
      reason: UnboundReason;
      note: string;
    }
  | {
      stage: FunnelStage;
      /**
       * `measurable`: the primary's inputs are ingested, so a figure can
       * exist. Whether rows exist for a video is a separate question for the
       * reader. `dark`: the primary waits on `blockers`.
       */
      status: 'measurable' | 'dark';
      primary: SignalSupport;
      supporting: readonly SignalSupport[];
      unavailable: readonly UnavailableSignal[];
      /** The primary's blockers; empty when measurable. */
      blockers: readonly string[];
    };

function hasFigure(level: SupportLevel): boolean {
  return level === 'native' || level === 'derived';
}

export function stageReading(
  platform: AnalyticsPlatform,
  format: PublishFormat,
  stage: FunnelStage,
): StageReading {
  const binding = SIGNAL_MAP[platform][format][stage];

  if (binding.primary === null) {
    return {
      stage,
      status: 'unbound',
      reason: binding.reason,
      note: binding.note,
    };
  }

  const primary = signalSupport(binding.primary, platform);

  return {
    stage,
    status: hasFigure(primary.level) ? 'measurable' : 'dark',
    primary,
    supporting: binding.supporting.map((signal) =>
      signalSupport(signal, platform),
    ),
    unavailable: binding.unavailable,
    blockers: primary.blockers,
  };
}

/** Every stage for one platform × format, in funnel order. */
export function stageReadings(
  platform: AnalyticsPlatform,
  format: PublishFormat,
): StageReading[] {
  return FUNNEL_STAGES.map((stage) => stageReading(platform, format, stage));
}

/**
 * Families that feed no stage, on purpose. Every family that is `native`
 * somewhere must be an input to a signal or be listed here with a reason.
 * Otherwise newly ingested data reaches no stage and nobody notices.
 */
export const FAMILIES_OUTSIDE_THE_FUNNEL: Partial<
  Record<MetricFamily, string>
> = {
  demographics:
    'Who watched, not how far through the funnel they got; a lens on every stage, not a stage.',
  geography:
    'Where viewers are, not how far through the funnel they got; a lens on every stage, not a stage.',
  device:
    'What viewers watched on, not how far through the funnel they got; a lens on every stage, not a stage.',
  channel_accounts_reached:
    'A channel’s reach over a 7- or 30-day window, not one video’s; a per-video stage cannot read it. FILM-1511’s channel card does.',
};
