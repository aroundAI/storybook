/**
 * View definition registry (FILM-1722).
 *
 * Every platform has a number called "views". They count different events,
 * and YouTube's changed meaning on 2026-08-27 — so `video_metrics.views`
 * holds two metrics under one name either side of that date. This module
 * records what each one means and when it began, so that a comparison
 * spanning a change is refused by name instead of computed.
 *
 * Pure and dependency-free, for the reason `lib/traffic-groups.ts` gives: a
 * browser bundle and a server action must read the same registry rather
 * than restate it. Every entry traces to a section of
 * `docs/platform-capability-reference.md`; the binding test lives in
 * `@kit/content-analytics` beside the one that parses that document.
 */
import type { AnalyticsPlatform, VideoMetric } from '../types';

/**
 * Deliberately wider than `AnalyticsPlatform`, so a platform's definitions
 * can be recorded before it is ingested. An entry for a platform outside
 * `AnalyticsPlatform` is inert: recorded, tested, and unreachable by any
 * query until FILM-1727 (X) widens that union. Facebook joined it in
 * FILM-1720.
 */
export type PlatformId = AnalyticsPlatform | 'x';

// A Record rather than an array so that widening either union is a type
// error here, which is what forces the new platform into PLATFORM_IDS —
// where the test then fails until it has a definition.
const PLATFORM_COVERAGE: Record<PlatformId, true> = {
  youtube: true,
  tiktok: true,
  instagram: true,
  facebook: true,
  x: true,
};

export const PLATFORM_IDS = Object.keys(PLATFORM_COVERAGE) as PlatformId[];

export type ViewCountsFrom =
  | 'first_frame'
  | 'past_first_frame'
  | 'one_millisecond'
  | 'three_seconds'
  | 'impression'
  /** Unique accounts reached, not plays: a reach figure used as a denominator. */
  | 'unique_account'
  | 'unknown';

/**
 * A yes/no the vendor may simply not have answered. `false` means the
 * vendor says no; `'undocumented'` means nobody has said, which is a
 * different statement and must not be flattened into it.
 */
export type VendorFact = boolean | 'undocumented';

/** YouTube is the only platform whose definition has depended on format. */
export type ViewFormat = 'shorts' | 'other';

interface ViewDefinitionFacts {
  /** Stable key; what `supersedes` points at and what a rate records. */
  id: string;
  platform: PlatformId;
  /** The vendor's own name for the concept, for a person to read. */
  label: string;
  /**
   * `views_column` is the chain behind `video_metrics.views`. `concurrent`
   * is a different denominator the vendor reports alongside it, which must
   * never be substituted for it.
   */
  role: 'views_column' | 'concurrent';
  countsFrom: ViewCountsFrom;
  /** Human-readable; null where the vendor states there is none or states nothing. */
  minimumWatch: string | null;
  includesReplays: VendorFact;
  includesPaid: VendorFact;
  isEstimated: VendorFact;
  appliesTo: 'all_formats' | 'shorts';
  /**
   * The vendor changed this on `effectiveFrom` but its API surfaces caught
   * up later, so a stored value between the two dates is one definition or
   * the other and nothing says which. A range touching that window is not
   * comparable.
   */
  rolloutCompleteBy?: string;
  /** A field on the same platform whose series is continuous across this chain's changes. */
  continuousAlternative?: string;
  /** Heading anchor in docs/platform-capability-reference.md this entry traces to. */
  reference: `#${string}`;
}

export type ViewDefinition = ViewDefinitionFacts &
  (
    | {
        availability: 'organic';
        /** The provider's own field name. */
        field: string;
        /**
         * Other spellings the vendor uses for this same number, e.g. a Media
         * node field beside its insights metric. Each must be named with
         * `field` on one line of the capability reference.
         */
        aliases?: readonly string[];
        /** The field-index block in the capability reference that documents `field`. */
        surface: string;
      }
    | {
        /** An Ads metric: there is no organic field to request it through. */
        availability: 'ads_only';
        field: null;
        surface: null;
      }
    | {
        /**
         * The vendor retired the field: requesting it errors on every API
         * version from `retiredOn`. Kept so a stored figure and the history
         * stay explained; no lookup resolves it and nothing may request it
         * (the capability reference's forbidden block says so).
         */
        availability: 'retired';
        /** The field as it was spelled, for the record. */
        field: string;
        surface: string;
        /** ISO date requesting it began to fail. */
        retiredOn: string;
        /** The vendor's page that says so. */
        retiredBy: string;
        /** Ids of the organic definitions the vendor names in its place; empty when it names none. */
        replacedBy: readonly string[];
      }
  ) &
  (
    | {
        /** ISO date. Null: no dated start on record — in force as far back as the vendor documents. */
        effectiveFrom: string | null;
        supersedes?: undefined;
      }
    | {
        /** A definition that replaced another always has a date. */
        effectiveFrom: string;
        /** The `id` of the definition it replaced. */
        supersedes: string;
      }
  );

export const VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    id: 'youtube.views.legacy',
    platform: 'youtube',
    field: 'views',
    surface: 'youtube/analytics-metrics',
    availability: 'organic',
    label: 'View (before unified counting)',
    role: 'views_column',
    countsFrom: 'past_first_frame',
    minimumWatch: 'played past the first frame, or clicked/tapped to play',
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    continuousAlternative: 'engagedViews',
    reference: '#youtube',
  },
  {
    id: 'youtube.views.shorts.2025-03-31',
    platform: 'youtube',
    field: 'views',
    surface: 'youtube/analytics-metrics',
    availability: 'organic',
    label: 'Shorts view (starts to play or replay)',
    role: 'views_column',
    countsFrom: 'first_frame',
    minimumWatch: null,
    includesReplays: true,
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'shorts',
    effectiveFrom: '2025-03-31',
    // Targeted queries switched on 2025-04-24 and bulk reports on
    // 2025-06-24; "until then, views will be based on the old methodology".
    rolloutCompleteBy: '2025-06-24',
    supersedes: 'youtube.views.legacy',
    continuousAlternative: 'engagedViews',
    reference: '#youtube',
  },
  {
    id: 'youtube.views.2026-08-27',
    platform: 'youtube',
    field: 'views',
    surface: 'youtube/analytics-metrics',
    availability: 'organic',
    label: 'View (from the moment playback begins, autoplay included)',
    role: 'views_column',
    countsFrom: 'first_frame',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: '2026-08-27',
    supersedes: 'youtube.views.legacy',
    continuousAlternative: 'engagedViews',
    reference: '#youtube',
  },
  {
    id: 'youtube.engagedViews',
    platform: 'youtube',
    field: 'engagedViews',
    surface: 'youtube/analytics-metrics',
    availability: 'organic',
    label: 'Engaged view (the previous view-counting methodology)',
    role: 'concurrent',
    countsFrom: 'past_first_frame',
    minimumWatch: 'played past the first frame, or clicked/tapped to play',
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: '2025-04-24',
    reference: '#youtube',
  },
  {
    id: 'tiktok.display.view_count',
    platform: 'tiktok',
    field: 'view_count',
    surface: 'tiktok/display-video',
    availability: 'organic',
    label: 'View count (Display API)',
    role: 'views_column',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#display-api-v2videoquery--the-shallow-one',
  },
  {
    id: 'tiktok.business.video_views',
    platform: 'tiktok',
    field: 'video_views',
    surface: 'tiktok/business',
    availability: 'organic',
    label: 'Video views (Business API, organic and paid together)',
    role: 'concurrent',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: true,
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#business-api-businessvideolist--the-real-one',
  },
  {
    id: 'instagram.plays',
    platform: 'instagram',
    field: 'plays',
    surface: 'instagram/media-insights',
    availability: 'organic',
    label: 'Plays (removed 2025-04-21)',
    role: 'views_column',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#added-2026-04-22',
  },
  {
    id: 'instagram.views',
    platform: 'instagram',
    field: 'views',
    surface: 'instagram/media-insights',
    availability: 'organic',
    label: 'Views (times the media has been played)',
    role: 'views_column',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: '2025-04-21',
    supersedes: 'instagram.plays',
    reference: '#added-2026-04-22',
  },
  {
    id: 'instagram.total_views',
    platform: 'instagram',
    field: 'total_views',
    // "The two names for each aggregate are one number reached two ways"
    aliases: ['total_views_count'],
    surface: 'instagram/media-insights-2026',
    availability: 'organic',
    label: 'Total views (all surfaces, boosted placements and replays)',
    role: 'concurrent',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: true,
    includesPaid: true,
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: '2026-04-22',
    reference: '#added-2026-04-22',
  },
  {
    id: 'instagram.reach',
    platform: 'instagram',
    field: 'reach',
    surface: 'instagram/media-insights',
    availability: 'organic',
    label: 'Reach (unique accounts that saw the media)',
    role: 'concurrent',
    countsFrom: 'unique_account',
    minimumWatch: null,
    includesReplays: false,
    includesPaid: 'undocumented',
    isEstimated: true,
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#instagram',
  },
  // Both retired by Graph v25.0's changelog for every version once v26.0
  // shipped (2026-07-29): "will return an error if requested using any API
  // version". Meta's video_insights page still lists them (read 2026-10-01);
  // FILM-1725 Check J is the live call that settles which page is right.
  // The replacements are Post Insights metrics, read on the video's Page
  // post, which the changelog names for post_impressions_unique.
  {
    id: 'facebook.total_video_impressions',
    platform: 'facebook',
    field: 'total_video_impressions',
    surface: 'facebook/video-insights',
    availability: 'retired',
    retiredOn: '2026-07-29',
    retiredBy:
      'https://developers.facebook.com/docs/graph-api/changelog/version25.0',
    replacedBy: ['facebook.post_media_view'],
    label: 'Impression (entered the screen; no playback required)',
    role: 'concurrent',
    countsFrom: 'impression',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: true,
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#the-four-denominators',
  },
  {
    id: 'facebook.post_impressions_unique',
    platform: 'facebook',
    field: 'post_impressions_unique',
    surface: 'facebook/video-insights',
    availability: 'retired',
    retiredOn: '2026-07-29',
    retiredBy:
      'https://developers.facebook.com/docs/graph-api/changelog/version25.0',
    replacedBy: ['facebook.post_total_media_view_unique'],
    label: 'Reach (unique impressions of a reel)',
    role: 'concurrent',
    countsFrom: 'unique_account',
    minimumWatch: null,
    includesReplays: false,
    includesPaid: 'undocumented',
    isEstimated: true,
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#facebook',
  },
  // The replacements, from the Insights reference
  // (https://developers.facebook.com/docs/graph-api/reference/insights/,
  // read 2026-10-01). A view here is "played or displayed": an impression
  // under another name, not a play.
  {
    id: 'facebook.post_media_view',
    platform: 'facebook',
    field: 'post_media_view',
    surface: 'facebook/post-insights',
    availability: 'organic',
    label: 'Media view (played or displayed)',
    role: 'concurrent',
    countsFrom: 'impression',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: true,
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#the-four-denominators',
  },
  {
    id: 'facebook.post_total_media_view_unique',
    platform: 'facebook',
    field: 'post_total_media_view_unique',
    surface: 'facebook/post-insights',
    availability: 'organic',
    label: 'Unique media viewers of the post',
    role: 'concurrent',
    countsFrom: 'unique_account',
    minimumWatch: null,
    includesReplays: false,
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#the-four-denominators',
  },
  {
    id: 'facebook.blue_reels_play_count',
    platform: 'facebook',
    field: 'blue_reels_play_count',
    surface: 'facebook/video-insights',
    availability: 'organic',
    label: 'Play (at least one millisecond, replays excluded)',
    role: 'concurrent',
    countsFrom: 'one_millisecond',
    minimumWatch: '1ms',
    includesReplays: false,
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#the-four-denominators',
  },
  {
    id: 'facebook.total_video_views',
    platform: 'facebook',
    field: 'total_video_views',
    surface: 'facebook/video-insights',
    availability: 'organic',
    label: '3-second view',
    role: 'concurrent',
    countsFrom: 'three_seconds',
    minimumWatch: '3s, or nearly full length if shorter than 3s',
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#the-four-denominators',
  },
  {
    id: 'facebook.thruplay',
    platform: 'facebook',
    field: null,
    surface: null,
    availability: 'ads_only',
    label: 'ThruPlay',
    role: 'concurrent',
    countsFrom: 'unknown',
    minimumWatch: 'completed, or 15s, whichever comes first',
    includesReplays: 'undocumented',
    includesPaid: true,
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#the-four-denominators',
  },
  {
    id: 'x.media_analytics.video_views',
    platform: 'x',
    field: 'video_views',
    surface: 'x/media-analytics',
    availability: 'organic',
    label: 'Video views (media analytics, Enterprise)',
    role: 'concurrent',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#enterprise--get-2mediaanalytics',
  },
  {
    id: 'x.media.view_count',
    platform: 'x',
    field: 'view_count',
    surface: 'x/media-object',
    availability: 'organic',
    label: 'View count (public and organic metrics)',
    role: 'concurrent',
    countsFrom: 'unknown',
    minimumWatch: null,
    includesReplays: 'undocumented',
    includesPaid: 'undocumented',
    isEstimated: 'undocumented',
    appliesTo: 'all_formats',
    effectiveFrom: null,
    reference: '#pay-per-use--the-degraded-path',
  },
];

export interface ViewDefinitionOptions {
  /**
   * A specific provider field. Omitted, the lookup follows the chain behind
   * `video_metrics.views` — which Facebook and X do not have.
   */
  field?: string;
  /** Omitted, a pooled figure is assumed: both formats' definitions apply. */
  format?: ViewFormat;
}

export type ViewDefinitionLookup =
  | { kind: 'single'; definition: ViewDefinition }
  /** A pooled YouTube figure between 2025-03-31 and 2026-08-27 is two metrics. */
  | { kind: 'by_format'; shorts: ViewDefinition; other: ViewDefinition }
  /** The platform reports several denominators and none of them is "views". */
  | {
      kind: 'no_single_view_definition';
      candidates: readonly ViewDefinition[];
    }
  | { kind: 'not_defined_on_date'; definedFrom: string };

/** One definition giving way to another. `date` is the first day of the new one. */
export interface ViewDefinitionChange {
  date: string;
  /** Equal to `date` unless the vendor rolled the change out across surfaces. */
  rolloutCompleteBy: string;
  from: ViewDefinition;
  to: ViewDefinition;
}

export interface ContinuousAlternative {
  field: string;
  definition: ViewDefinition;
  /** False when the alternative began after the range did: offer it, but say so. */
  coversRange: boolean;
}

/** Why a comparison over views is withheld. Named, so it can reach the screen. */
export type ViewComparisonSuppressionReason =
  | 'view_definition_changed'
  | 'no_single_view_definition'
  | 'not_defined_for_whole_range';

export type ViewComparability =
  | { comparable: true; definition: ViewDefinitionLookup }
  | {
      comparable: false;
      reason: 'view_definition_changed';
      /** The earliest change in the range. */
      changedOn: string;
      changes: readonly ViewDefinitionChange[];
      continuousAlternative: ContinuousAlternative | null;
    }
  | { comparable: false; reason: 'no_single_view_definition' }
  | {
      comparable: false;
      reason: 'not_defined_for_whole_range';
      definedFrom: string;
    };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertIsoDate(value: string): void {
  const match = ISO_DATE.exec(value);
  const parsed = match
    ? new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      )
    : null;

  // Round-tripped, because Date.UTC turns 2026-02-30 into 2 March without
  // complaint and ISO strings are only orderable if they are real dates.
  if (!parsed || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Expected an ISO date (YYYY-MM-DD), got '${value}'`);
  }
}

/**
 * The definitions a lookup walks: one field's, or the views-column chain.
 * Ads-only entries have no field, so they are never part of a series.
 */
function seriesFor(
  platform: PlatformId,
  field: string | undefined,
): readonly ViewDefinition[] {
  const onPlatform = VIEW_DEFINITIONS.filter(
    (entry) => entry.platform === platform,
  );

  if (field === undefined) {
    return onPlatform.filter((entry) => entry.role === 'views_column');
  }

  const direct = onPlatform.filter(
    (entry) =>
      entry.availability === 'organic' &&
      (entry.field === field || (entry.aliases ?? []).includes(field)),
  );

  if (direct.length === 0) {
    throw new RangeError(
      `No view definition for field '${field}' on ${platform}`,
    );
  }

  // A renamed field (`plays` → `views`) is still one series.
  const ids = new Set(direct.map((entry) => entry.id));
  const linked = onPlatform.filter(
    (entry) =>
      !ids.has(entry.id) &&
      (direct.some((member) => member.supersedes === entry.id) ||
        (entry.supersedes !== undefined && ids.has(entry.supersedes))),
  );

  return [...direct, ...linked];
}

function appliesToFormat(entry: ViewDefinition, format: ViewFormat): boolean {
  return entry.appliesTo === 'all_formats' || entry.appliesTo === format;
}

function inForceOn(
  series: readonly ViewDefinition[],
  date: string,
  format: ViewFormat,
): ViewDefinition | undefined {
  return series
    .filter(
      (entry) =>
        appliesToFormat(entry, format) &&
        (entry.effectiveFrom === null || entry.effectiveFrom <= date),
    )
    .sort((a, b) =>
      (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''),
    )
    .at(-1);
}

/** What `views` — or a named field — meant on a given day. */
export function viewDefinitionAt(
  platform: PlatformId,
  date: string,
  options: ViewDefinitionOptions = {},
): ViewDefinitionLookup {
  assertIsoDate(date);

  const series = seriesFor(platform, options.field);

  if (series.length === 0) {
    return {
      kind: 'no_single_view_definition',
      candidates: VIEW_DEFINITIONS.filter(
        (entry) =>
          entry.platform === platform && entry.availability === 'organic',
      ),
    };
  }

  const shorts = inForceOn(series, date, 'shorts');
  const other = inForceOn(series, date, 'other');
  const chosen =
    options.format === 'shorts'
      ? shorts
      : options.format === 'other'
        ? other
        : undefined;

  if (options.format !== undefined && chosen) {
    return { kind: 'single', definition: chosen };
  }

  if (options.format === undefined && shorts && other) {
    return shorts === other
      ? { kind: 'single', definition: shorts }
      : { kind: 'by_format', shorts, other };
  }

  // Nothing in force yet, so every member of the series is dated.
  const definedFrom = series
    .map((entry) => entry.effectiveFrom)
    .filter((from): from is string => from !== null)
    .sort()[0]!;

  return { kind: 'not_defined_on_date', definedFrom };
}

/**
 * The definition changes a range holds both sides of, earliest first — what
 * a chart marks instead of drawing the step as though it were real.
 */
export function viewDefinitionChangesBetween(
  platform: PlatformId,
  from: string,
  to: string,
  options: ViewDefinitionOptions = {},
): ViewDefinitionChange[] {
  assertIsoDate(from);
  assertIsoDate(to);

  if (from > to) {
    throw new RangeError(`Range runs backwards: ${from} to ${to}`);
  }

  const series = seriesFor(platform, options.field);
  const { format } = options;

  return series
    .flatMap((entry) => {
      if (entry.supersedes === undefined) return [];
      if (format !== undefined && !appliesToFormat(entry, format)) return [];

      const rolloutCompleteBy = entry.rolloutCompleteBy ?? entry.effectiveFrom;

      // Wholly before the change, or wholly after its rollout: one side only.
      if (to < entry.effectiveFrom || from >= rolloutCompleteBy) return [];

      const replaced = series.find(
        (candidate) => candidate.id === entry.supersedes,
      );

      if (!replaced) return [];

      return [
        {
          date: entry.effectiveFrom,
          rolloutCompleteBy,
          from: replaced,
          to: entry,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function continuousAlternativeFor(
  platform: PlatformId,
  changes: readonly ViewDefinitionChange[],
  from: string,
): ContinuousAlternative | null {
  const field = changes[0]?.to.continuousAlternative;

  if (field === undefined) return null;

  const definition = VIEW_DEFINITIONS.find(
    (entry) =>
      entry.platform === platform &&
      entry.field === field &&
      entry.supersedes === undefined,
  );

  if (!definition) return null;

  return {
    field,
    definition,
    coversRange:
      definition.effectiveFrom === null || definition.effectiveFrom <= from,
  };
}

/**
 * Whether views over `from`–`to` (inclusive) are one metric throughout.
 *
 * False when a definition change falls inside the range, with the date and
 * the continuous alternative where the platform has one. The caller shows
 * the reason in place of the figure; it does not compute the figure anyway.
 */
export function comparableAcross(
  platform: PlatformId,
  from: string,
  to: string,
  options: ViewDefinitionOptions = {},
): ViewComparability {
  const changes = viewDefinitionChangesBetween(platform, from, to, options);

  if (changes.length > 0) {
    return {
      comparable: false,
      reason: 'view_definition_changed',
      changedOn: changes[0]!.date,
      changes,
      continuousAlternative: continuousAlternativeFor(platform, changes, from),
    };
  }

  const definition = viewDefinitionAt(platform, from, options);

  if (definition.kind === 'no_single_view_definition') {
    return { comparable: false, reason: 'no_single_view_definition' };
  }

  if (definition.kind === 'not_defined_on_date') {
    return {
      comparable: false,
      reason: 'not_defined_for_whole_range',
      definedFrom: definition.definedFrom,
    };
  }

  return { comparable: true, definition };
}

/**
 * The platforms whose `video_metrics.views` holds a figure: those with a
 * definition behind the column. Facebook has none and writes NULL there
 * (FILM-1720), so a reader that counts videos or takes a median of their
 * views keeps to these, or a Facebook video joins the sample as a zero.
 */
export const VIEWS_COLUMN_PLATFORMS: readonly AnalyticsPlatform[] = [
  ...new Set(
    VIEW_DEFINITIONS.filter((entry) => entry.role === 'views_column').map(
      (entry) => entry.platform,
    ),
  ),
].filter((platform): platform is AnalyticsPlatform => platform !== 'x');

/** The `video_metrics` columns a views denominator can be read from. */
export type ViewsColumn = Extract<keyof VideoMetric, 'views' | 'engaged_views'>;

/**
 * Continuous alternatives that are stored, and where. An alternative the
 * registry knows but ingest does not keep cannot be read, so it is not here
 * and a range needing it is suppressed.
 */
const STORED_ALTERNATIVES: Readonly<Record<string, ViewsColumn>> = {
  'youtube.engagedViews': 'engaged_views',
};

/**
 * Which series a views figure over `from`–`to` may be computed on, and under
 * which definitions, or why it may not be computed at all. Never a number:
 * the caller reads the column it is given and stamps the definitions on
 * what it computes (FILM-1713), or shows the reason in place of a figure.
 */
export type ViewsDenominator =
  | {
      kind: 'column';
      column: ViewsColumn;
      /** What the figure was measured under; two for a pooled YouTube figure between format changes. */
      definitions: readonly ViewDefinition[];
      /** Present when `views` could not be used: the change the alternative bridges. */
      instead?: {
        reason: 'view_definition_changed';
        changedOn: string;
        changes: readonly ViewDefinitionChange[];
      };
    }
  | {
      kind: 'suppressed';
      reason: 'view_definition_changed';
      changedOn: string;
      changes: readonly ViewDefinitionChange[];
      /** Offered with `coversRange: false` where it exists but starts too late. */
      continuousAlternative: ContinuousAlternative | null;
    }
  | { kind: 'suppressed'; reason: 'no_single_view_definition' }
  | {
      kind: 'suppressed';
      reason: 'not_defined_for_whole_range';
      definedFrom: string;
    };

function definitionsOf(
  lookup: ViewDefinitionLookup,
): readonly ViewDefinition[] {
  if (lookup.kind === 'single') return [lookup.definition];
  if (lookup.kind === 'by_format') return [lookup.shorts, lookup.other];
  return [];
}

/**
 * The one place a views denominator is chosen (FILM-1722): `views` when the
 * range is one definition, the stored continuous alternative when a change
 * falls inside it and the alternative covers the whole range, and otherwise
 * the registry's own reason, unchanged.
 */
export function viewsDenominatorFor(
  platform: PlatformId,
  from: string,
  to: string,
  options: Pick<ViewDefinitionOptions, 'format'> = {},
): ViewsDenominator {
  const comparability = comparableAcross(platform, from, to, options);

  if (comparability.comparable) {
    return {
      kind: 'column',
      column: 'views',
      definitions: definitionsOf(comparability.definition),
    };
  }

  if (comparability.reason !== 'view_definition_changed') {
    return comparability.reason === 'no_single_view_definition'
      ? { kind: 'suppressed', reason: 'no_single_view_definition' }
      : {
          kind: 'suppressed',
          reason: 'not_defined_for_whole_range',
          definedFrom: comparability.definedFrom,
        };
  }

  const { changedOn, changes, continuousAlternative } = comparability;
  const column = continuousAlternative
    ? STORED_ALTERNATIVES[continuousAlternative.definition.id]
    : undefined;

  if (continuousAlternative?.coversRange && column) {
    return {
      kind: 'column',
      column,
      definitions: [continuousAlternative.definition],
      instead: { reason: 'view_definition_changed', changedOn, changes },
    };
  }

  return {
    kind: 'suppressed',
    reason: 'view_definition_changed',
    changedOn,
    changes,
    continuousAlternative,
  };
}

/**
 * A `video_metrics` column holding an all-surface aggregate. Disjoint from
 * `ViewsColumn` by construction, so no views denominator can be read from one.
 */
export type AllSurfaceColumn = Extract<
  keyof VideoMetric,
  `all_surface_${string}`
>;

/**
 * Instagram's all-surface aggregates: Media node fields, Facebook Login
 * only, added 2026-04-22 (docs/platform-capability-reference.md, "Added
 * 2026-04-22"). Each folds in boosted placements, and `total_views_count`
 * replays too, so none is the number the `views`, `likes` or `comments`
 * insight beside it reports, and none is stored or shown as one.
 *
 * The provider's request is built from this table
 * (`INSTAGRAM_AGGREGATE_FIELDS`), so an aggregate is requested only once it
 * is defined here. Shape approved 2026-10-01 (FILM-1722).
 */
export interface InstagramAggregate {
  /** The Media node field requested. */
  field: string;
  /** The insights-metric spelling of the same number. */
  insightsMetric: string;
  /** Lifetime in `video_snapshots`, the day's increase in `video_metrics`. */
  column: AllSurfaceColumn;
  label: string;
  includesBoosted: true;
  includesReplays: VendorFact;
  /** `total_views_count` is reported for video only. */
  videoOnly: boolean;
  effectiveFrom: '2026-04-22';
  /** The views aggregate's entry in VIEW_DEFINITIONS (role `concurrent`). */
  viewDefinition?: string;
  reference: '#added-2026-04-22';
}

export const INSTAGRAM_AGGREGATES: readonly InstagramAggregate[] = [
  {
    field: 'total_views_count',
    insightsMetric: 'total_views',
    column: 'all_surface_views',
    label: 'Views on all surfaces, including boosted placements and replays',
    includesBoosted: true,
    includesReplays: true,
    videoOnly: true,
    effectiveFrom: '2026-04-22',
    viewDefinition: 'instagram.total_views',
    reference: '#added-2026-04-22',
  },
  {
    field: 'total_like_count',
    insightsMetric: 'total_likes',
    column: 'all_surface_likes',
    label: 'Likes on all surfaces, including boosted placements',
    includesBoosted: true,
    includesReplays: 'undocumented',
    videoOnly: false,
    effectiveFrom: '2026-04-22',
    reference: '#added-2026-04-22',
  },
  {
    field: 'total_comments_count',
    insightsMetric: 'total_comments',
    column: 'all_surface_comments',
    label: 'Comments on all surfaces, including boosted placements',
    includesBoosted: true,
    includesReplays: 'undocumented',
    videoOnly: false,
    effectiveFrom: '2026-04-22',
    reference: '#added-2026-04-22',
  },
];

/** The aggregates' Media node `fields=` list, in table order. */
export const INSTAGRAM_AGGREGATE_FIELDS = INSTAGRAM_AGGREGATES.map(
  (aggregate) => aggregate.field,
).join(',');
