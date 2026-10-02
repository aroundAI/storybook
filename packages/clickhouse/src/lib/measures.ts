/**
 * Normalised measures (FILM-1713): every rate in the product, defined once.
 *
 * A rate either has a value — stamped with the denominator that produced it
 * and the view definitions, with their effective dates, that denominator was
 * counted under — or it is absent with a named reason. There is no third
 * shape: no `null` without a reason, no `0` standing in for "this platform
 * does not report it", no `Infinity` from a zero denominator.
 *
 * The denominator is chosen by FILM-1722's `viewsDenominatorFor`, never here:
 * `views` where the window is one definition, `engaged_views` where it bridges
 * YouTube's 2026-08-27 change, otherwise the registry's reason.
 *
 * Pure and client-safe, like the rest of `lib/`.
 */
import type { AnalyticsPlatform } from '../types';
import type {
  ContinuousAlternative,
  ViewDefinition,
  ViewDefinitionChange,
  ViewFormat,
  ViewsColumn,
  ViewsDenominator,
} from './view-definitions';
import {
  PLATFORM_IDS,
  VIEW_DEFINITIONS,
  viewDefinitionAt,
  viewDefinitionChangesBetween,
  viewsDenominatorFor,
} from './view-definitions';

export type MeasureId =
  | 'engagement_rate'
  | 'share_rate'
  | 'save_rate'
  | 'subscriber_conversion'
  | 'attention_efficiency';

/** A rate over views (or reach). Attention efficiency divides by duration instead. */
export type RateMeasureId = Exclude<MeasureId, 'attention_efficiency'>;

/**
 * Inputs whose support differs by platform. Likes and comments every platform
 * reports; shares every one but X, whose pay-per-use tier has none (FILM-1727).
 */
export type MeasureInput = 'shares' | 'saves' | 'subscribers_gained' | 'reach';

/** Instagram's `media_product_type`: it decides which metrics exist. */
export type InstagramMediaSurface = 'REELS' | 'FEED' | 'STORY';

/**
 * Whether a platform reports an input, as the capability reference says.
 * `measure-input-sources.test.ts` in @kit/content-analytics binds every cell
 * to the reference's field index, so none of this is our own belief.
 */
export type InputSupportCell =
  | {
      support: 'reported';
      /** The vendor's field, and the reference block that documents it. */
      field: string;
      block: string;
    }
  | {
      /** Reported, except on these surfaces, where the stored value is a structural zero. */
      support: 'reported_except_on';
      field: string;
      block: string;
      mediaSurfaces: readonly InstagramMediaSurface[];
    }
  | {
      /** The vendor has no such metric on the surfaces we read. */
      support: 'not_reported';
      /** Names it would go by; none may appear in `absentFrom`. */
      candidates: readonly string[];
      absentFrom: readonly string[];
    }
  | {
      /** The vendor reports it; we do not store it yet. */
      support: 'not_ingested';
      field: string;
      block: string;
      closedBy: string;
    };

const NO_SAVES = ['saves', 'saved', 'favorites_count', 'collect_count'];

/**
 * Per-platform support for the inputs that vary. A platform added to
 * `AnalyticsPlatform` fails typecheck here until someone says what it reports.
 *
 * The zeros ingest writes for these (`analytics-sync-cron.ts`: "YouTube doesn't
 * have saves", "TikTok doesn't provide per-video follower gains", Instagram
 * `follows ?? 0` on a Reel) are the reason this table exists: dividing them
 * would print 0% where the truth is "not reported".
 */
export const MEASURE_INPUT_SUPPORT: Readonly<
  Record<
    AnalyticsPlatform,
    Readonly<Partial<Record<MeasureInput, InputSupportCell>>>
  >
> = {
  youtube: {
    shares: {
      support: 'reported',
      field: 'shares',
      block: 'youtube/analytics-metrics',
    },
    saves: {
      support: 'not_reported',
      candidates: NO_SAVES,
      absentFrom: [
        'youtube/analytics-metrics',
        'youtube/data-api',
        'youtube/reporting',
      ],
    },
    subscribers_gained: {
      support: 'reported',
      field: 'subscribersGained',
      block: 'youtube/analytics-metrics',
    },
  },
  tiktok: {
    shares: {
      support: 'reported',
      field: 'share_count',
      block: 'tiktok/display-video',
    },
    saves: {
      support: 'not_reported',
      candidates: NO_SAVES,
      absentFrom: ['tiktok/display-video', 'tiktok/business'],
    },
    subscribers_gained: {
      support: 'not_reported',
      candidates: ['follows', 'followers_gained', 'new_followers'],
      absentFrom: ['tiktok/display-video', 'tiktok/business'],
    },
  },
  instagram: {
    shares: {
      support: 'reported',
      field: 'shares',
      block: 'instagram/media-insights',
    },
    saves: {
      support: 'reported',
      field: 'saved',
      block: 'instagram/media-insights',
    },
    subscribers_gained: {
      support: 'reported_except_on',
      field: 'follows',
      block: 'instagram/media-insights',
      mediaSurfaces: ['REELS'],
    },
    reach: {
      support: 'not_ingested',
      field: 'reach',
      block: 'instagram/media-insights',
      closedBy: 'FILM-1712',
    },
  },
  facebook: {
    shares: {
      support: 'reported',
      field: 'shares',
      block: 'facebook/post-fields',
    },
    saves: {
      support: 'not_reported',
      candidates: NO_SAVES,
      absentFrom: ['facebook/video-insights'],
    },
    // Follows attributed to a reel. Every Facebook publish here is a reel.
    subscribers_gained: {
      support: 'reported',
      field: 'post_video_followers',
      block: 'facebook/video-insights',
    },
  },
  // FILM-1727: the pay-per-use posts lookup. Shares and per-post follows are
  // Enterprise-only; a bookmark is X's save.
  twitter: {
    shares: {
      support: 'not_ingested',
      field: 'shares',
      block: 'x/post-analytics',
      closedBy: 'FILM-1727',
    },
    saves: {
      support: 'reported',
      field: 'bookmark_count',
      block: 'x/post-metrics',
    },
    subscribers_gained: {
      support: 'not_ingested',
      field: 'follows',
      block: 'x/post-analytics',
      closedBy: 'FILM-1727',
    },
  },
};

/**
 * The denominator a rate should use per platform. Instagram's is reach — a
 * rate over unique accounts reached, not plays — which is requested and
 * dropped at ingest until FILM-1712, so today every Instagram rate is the
 * fallback over views and says so.
 */
export const PREFERRED_DENOMINATOR: Readonly<
  Record<AnalyticsPlatform, 'views' | 'reach'>
> = {
  youtube: 'views',
  tiktok: 'views',
  instagram: 'reach',
  // Asked for, and refused: Facebook has no single view (FILM-1722), so every
  // Facebook rate is absent as `no_single_view_definition` (FILM-1720).
  facebook: 'views',
  twitter: 'views',
};

/**
 * One platform's part in a denominator over a window (FILM-1732): the
 * definitions its figure was counted under, or why it added nothing.
 */
/**
 * A definition as a record names it: enough to say what a view was and since
 * when. A record rides on every rate a read returns, so it carries the id
 * that keys the registry rather than the registry's whole entry (FILM-1732).
 */
export type ViewDefinitionRef = Pick<
  ViewDefinition,
  'id' | 'platform' | 'label' | 'effectiveFrom'
>;

/** A change a window crosses: the day, and the definitions either side. */
export interface DenominatorChange {
  date: string;
  from: ViewDefinitionRef;
  to: ViewDefinitionRef;
}

export type DenominatorPlatform =
  | {
      platform: AnalyticsPlatform;
      inDenominator: true;
      /** Every definition in force at some point in the window, earliest first. */
      definitions: readonly ViewDefinitionRef[];
    }
  | {
      platform: AnalyticsPlatform;
      inDenominator: false;
      /** Facebook stores NULL views (FILM-1720 option A): no definition to name. */
      reason: 'no_single_view_definition';
    };

/** What a rate divided by, stamped on every value. */
export interface DenominatorStamp {
  column: ViewsColumn | 'reach';
  role: 'preferred' | 'fallback';
  fallbackFor?: {
    preferred: 'reach';
    because: 'not_ingested' | 'not_reported';
  };
  /** Each with its `effectiveFrom`: what the figure was counted under. */
  definitions: readonly ViewDefinitionRef[];
  /** Present when the window crossed a change `engaged_views` bridges. */
  bridged?: {
    reason: 'view_definition_changed';
    changedOn: string;
    changes: readonly ViewDefinitionChange[];
  };
  /** The days the figure was counted over, inclusive (FILM-1732). */
  window: { from: string; to: string };
  /** Each platform pooled into the figure, and how it entered the denominator. */
  platforms: readonly DenominatorPlatform[];
  /**
   * The definition changes inside the window, earliest first: the figure
   * counts both sides of each. Recorded, never suppressed — suppressing
   * changes the figure, which is FILM-1719's (FILM-1732 §1).
   */
  crosses: readonly DenominatorChange[];
}

/**
 * A rate as a read returns it (FILM-1732): today's figure and what it was
 * divided by, together, so a card cannot render one without the other.
 */
export interface RecordedRate {
  value: number;
  denominator: DenominatorStamp;
}

export type MeasureAbsence =
  | {
      reason: 'input_not_reported';
      input: Exclude<MeasureInput, 'reach'>;
      platform: AnalyticsPlatform;
    }
  | { reason: 'media_surface_unknown'; input: Exclude<MeasureInput, 'reach'> }
  | { reason: 'zero_denominator' }
  | { reason: 'denominator_not_reported'; column: ViewsColumn | 'reach' }
  | { reason: 'duration_unknown' }
  | {
      reason: 'view_definition_changed';
      changedOn: string;
      changes: readonly ViewDefinitionChange[];
      continuousAlternative: ContinuousAlternative | null;
    }
  | { reason: 'no_single_view_definition' }
  | { reason: 'not_defined_for_whole_range'; definedFrom: string };

export type Measure =
  | {
      kind: 'value';
      measure: RateMeasureId;
      /** A ratio, 0.1 for 10%. Presentation multiplies. */
      value: number;
      denominator: DenominatorStamp;
      window: { from: string; to: string };
    }
  | { kind: 'absent'; measure: RateMeasureId; reason: MeasureAbsence };

export type AttentionEfficiency =
  | { kind: 'value'; measure: 'attention_efficiency'; value: number }
  | {
      kind: 'absent';
      measure: 'attention_efficiency';
      reason: { reason: 'duration_unknown' };
    };

/** Counts over one window, one row's worth; `engaged_views` null means not reported. */
export interface MeasureCounts {
  views: number;
  engaged_views?: number | null;
  reach?: number | null;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  subscribers_gained: number;
}

type EngagementCounts = Pick<MeasureCounts, 'likes' | 'comments' | 'shares'>;

/** The numerator of each rate, and the one input each depends on beyond likes and comments. */
const NUMERATOR: Record<
  RateMeasureId,
  {
    of: (counts: MeasureCounts) => number;
    needs?: Exclude<MeasureInput, 'reach'>;
  }
> = {
  engagement_rate: { of: (c) => engagementNumerator(c), needs: 'shares' },
  share_rate: { of: (c) => c.shares, needs: 'shares' },
  save_rate: { of: (c) => c.saves, needs: 'saves' },
  subscriber_conversion: {
    of: (c) => c.subscribers_gained,
    needs: 'subscribers_gained',
  },
};

function engagementNumerator(counts: EngagementCounts): number {
  return counts.likes + counts.comments + counts.shares;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Engagement rate: (likes + comments + shares) / denominator. The one
 * definition in the repository; `engagement-rate-one-definition.test.ts`
 * fails any other file that computes it inline. Null over a zero denominator.
 */
export function engagementRatio(
  counts: EngagementCounts,
  denominator: number,
): number | null {
  return ratio(engagementNumerator(counts), denominator);
}

/**
 * The engagement percentage the dashboards show today: the one definition,
 * over the stored views column, 0 where there are no views.
 *
 * Held deliberately until FILM-1719 can explain the change on screen — the
 * owner's ruling of 2026-09-22 (FILM-1722 §12): a figure is not switched to
 * engaged views, nor suppressed, before the copy that says why. New surfaces
 * read `computeMeasure` instead, which never returns that 0.
 */
export function displayedEngagementRatePercent(
  totals: EngagementCounts & { views: number },
): number {
  const value = engagementRatio(totals, totals.views);
  return value === null ? 0 : value * 100;
}

function inputAbsence(
  platform: AnalyticsPlatform,
  input: Exclude<MeasureInput, 'reach'>,
  mediaSurface: InstagramMediaSurface | undefined,
): MeasureAbsence | null {
  const cell = MEASURE_INPUT_SUPPORT[platform][input];

  if (
    !cell ||
    cell.support === 'not_reported' ||
    cell.support === 'not_ingested'
  ) {
    return { reason: 'input_not_reported', input, platform };
  }

  if (cell.support === 'reported_except_on') {
    if (mediaSurface === undefined) {
      return { reason: 'media_surface_unknown', input };
    }
    if (cell.mediaSurfaces.includes(mediaSurface)) {
      return { reason: 'input_not_reported', input, platform };
    }
  }

  return null;
}

function reachDefinition(platform: AnalyticsPlatform): ViewDefinition | null {
  return (
    VIEW_DEFINITIONS.find(
      (entry) =>
        entry.platform === platform &&
        entry.availability === 'organic' &&
        entry.field === 'reach',
    ) ?? null
  );
}

/**
 * A rate over one window of one video (or one aggregate of a platform's
 * rows): a value stamped with its denominator, or the reason there is none.
 */
export function computeMeasure(
  measure: RateMeasureId,
  input: {
    platform: AnalyticsPlatform;
    from: string;
    to: string;
    format?: ViewFormat;
    /** Instagram only: which metrics exist depends on it. */
    mediaSurface?: InstagramMediaSurface;
    counts: MeasureCounts;
  },
): Measure {
  const { platform, from, to, counts } = input;
  const absent = (reason: MeasureAbsence): Measure => ({
    kind: 'absent',
    measure,
    reason,
  });

  const needs = NUMERATOR[measure].needs;
  if (needs) {
    const missing = inputAbsence(platform, needs, input.mediaSurface);
    if (missing) return absent(missing);
  }

  const numerator = NUMERATOR[measure].of(counts);

  // Reach first, where it is the platform's preferred denominator and stored.
  if (PREFERRED_DENOMINATOR[platform] === 'reach') {
    const cell = MEASURE_INPUT_SUPPORT[platform].reach;
    const definition = reachDefinition(platform);

    if (cell?.support === 'reported' && definition && counts.reach != null) {
      const value = ratio(numerator, counts.reach);
      return value === null
        ? absent({ reason: 'zero_denominator' })
        : {
            kind: 'value',
            measure,
            value,
            denominator: {
              column: 'reach',
              role: 'preferred',
              definitions: [definition],
              window: { from, to },
              platforms: [
                { platform, inDenominator: true, definitions: [definition] },
              ],
              crosses: [],
            },
            window: { from, to },
          };
    }
  }

  const chosen = viewsDenominatorFor(platform, from, to, {
    format: input.format,
  });

  if (chosen.kind === 'suppressed') {
    const { kind: _kind, ...reason } = chosen;
    return absent(reason);
  }

  const denominatorValue = counts[chosen.column];

  if (denominatorValue == null) {
    return absent({
      reason: 'denominator_not_reported',
      column: chosen.column,
    });
  }

  const value = ratio(numerator, denominatorValue);

  if (value === null) return absent({ reason: 'zero_denominator' });

  return {
    kind: 'value',
    measure,
    value,
    denominator: chosenColumnRecord(platform, chosen, { from, to }),
    window: { from, to },
  };
}

/**
 * The record of a views column FILM-1722's `viewsDenominatorFor` chose for
 * one platform: `views` over one definition, or `engaged_views` bridging a
 * change. Either way the column was one metric throughout, so it crosses
 * nothing. One builder for `computeMeasure` and the genome's cohorts.
 */
export function chosenColumnRecord(
  platform: AnalyticsPlatform,
  chosen: Extract<ViewsDenominator, { kind: 'column' }>,
  window: { from: string; to: string },
): DenominatorStamp {
  const isFallback = PREFERRED_DENOMINATOR[platform] === 'reach';
  const reachCell = MEASURE_INPUT_SUPPORT[platform].reach;
  const definitions = chosen.definitions.map(definitionRef);

  return {
    column: chosen.column,
    role: isFallback ? 'fallback' : 'preferred',
    ...(isFallback
      ? {
          fallbackFor: {
            preferred: 'reach' as const,
            because:
              reachCell?.support === 'not_ingested'
                ? ('not_ingested' as const)
                : ('not_reported' as const),
          },
        }
      : {}),
    definitions,
    ...(chosen.instead
      ? {
          bridged: {
            reason: chosen.instead.reason,
            changedOn: chosen.instead.changedOn,
            changes: chosen.instead.changes,
          },
        }
      : {}),
    window,
    platforms: [{ platform, inDenominator: true, definitions }],
    crosses: [],
  };
}

/**
 * Attention efficiency: average view duration over the asset's duration
 * (FILM-1710). A null or zero duration is `duration_unknown`, never a figure.
 * Defined here; rendering it waits on FILM-1710's backfill (spec: out of scope).
 */
export function attentionEfficiency(input: {
  avgViewDurationSeconds: number;
  assetDurationSeconds: number | null;
}): AttentionEfficiency {
  const value =
    input.assetDurationSeconds == null
      ? null
      : ratio(input.avgViewDurationSeconds, input.assetDurationSeconds);

  return value === null
    ? {
        kind: 'absent',
        measure: 'attention_efficiency',
        reason: { reason: 'duration_unknown' },
      }
    : { kind: 'value', measure: 'attention_efficiency', value };
}

// =============================================================================
// Rate denominator records (FILM-1732)
// =============================================================================

/** The days a pooled figure was counted over, inclusive, as ISO dates. */
export interface DenominatorWindow {
  from: string;
  to: string;
}

const PLATFORM_NAMES: Record<AnalyticsPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X',
};

function isoDay(value: Date | string): string {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

/**
 * The window of a read with no date filter: lifetime totals were counted
 * from the earliest publish in the set to the day of the read, so that is
 * the span the record covers — not "no window" (FILM-1732 §3).
 */
export function lifetimeWindow(
  publishedAt: Iterable<string | null | undefined>,
  readOn: Date = new Date(),
): DenominatorWindow {
  const to = isoDay(readOn);
  const earliest = [...publishedAt]
    .filter((value): value is string => Boolean(value))
    .map(isoDay)
    .sort()[0];

  return { from: earliest && earliest < to ? earliest : to, to };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The window as ISO days, or null where it cannot be read: a timestamp is
 * cut to its day, and a malformed or backwards range is not a window.
 */
function readableWindow(window: DenominatorWindow): DenominatorWindow | null {
  const from = window.from?.slice(0, 10) ?? '';
  const to = window.to?.slice(0, 10) ?? '';
  const valid = (day: string) =>
    ISO_DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));

  return valid(from) && valid(to) && from <= to ? { from, to } : null;
}

function definitionRef({
  id,
  platform,
  label,
  effectiveFrom,
}: ViewDefinition): ViewDefinitionRef {
  return { id, platform, label, effectiveFrom };
}

function definitionsOver(
  platform: AnalyticsPlatform,
  from: string,
  changes: readonly ViewDefinitionChange[],
): readonly ViewDefinition[] | null {
  const atStart = viewDefinitionAt(platform, from);

  if (atStart.kind === 'no_single_view_definition') return null;

  const found =
    atStart.kind === 'single'
      ? [atStart.definition]
      : atStart.kind === 'by_format'
        ? [atStart.shorts, atStart.other]
        : [];

  for (const change of changes) found.push(change.from, change.to);

  return [...new Map(found.map((entry) => [entry.id, entry])).values()].sort(
    (a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''),
  );
}

/**
 * What a rate over the stored `views` column divided by, for the platforms
 * pooled into it over `window` — the one place a FILM-1732 record is built.
 * Pure: the reads pass what they summed, and nothing re-derives it.
 *
 * A platform whose views are NULL (Facebook) is recorded as not in the
 * denominator. Every definition change inside the window is recorded in
 * `crosses`; the figure is not touched.
 */
export function recordViewsDenominator(scope: {
  platforms: Iterable<string>;
  window: DenominatorWindow;
}): DenominatorStamp {
  const named = new Set(scope.platforms);
  const window = readableWindow(scope.window);
  const { from, to } = window ?? { from: '', to: '' };
  const crosses: DenominatorChange[] = [];

  const platforms = PLATFORM_IDS.filter((platform) => named.has(platform)).map(
    (platform): DenominatorPlatform => {
      // No readable days, no definitions to name: the record says so
      // rather than failing the read the figure came from.
      if (window === null) {
        return viewDefinitionAt(platform, isoDay(new Date())).kind ===
          'no_single_view_definition'
          ? {
              platform,
              inDenominator: false,
              reason: 'no_single_view_definition',
            }
          : { platform, inDenominator: true, definitions: [] };
      }

      const changes = viewDefinitionChangesBetween(platform, from, to);
      const definitions = definitionsOver(platform, from, changes);

      if (definitions === null) {
        return {
          platform,
          inDenominator: false,
          reason: 'no_single_view_definition',
        };
      }

      crosses.push(
        ...changes.map((change) => ({
          date: change.date,
          from: definitionRef(change.from),
          to: definitionRef(change.to),
        })),
      );

      return {
        platform,
        inDenominator: true,
        definitions: definitions.map(definitionRef),
      };
    },
  );

  // Instagram's own rates prefer reach (not yet ingested, FILM-1712): any
  // views figure that pools Instagram is, for that part, the fallback.
  const fallback = platforms.find(
    (part) =>
      part.inDenominator && PREFERRED_DENOMINATOR[part.platform] === 'reach',
  );
  const reachSupport = fallback
    ? MEASURE_INPUT_SUPPORT[fallback.platform].reach?.support
    : undefined;

  return {
    column: 'views',
    role: fallback ? 'fallback' : 'preferred',
    ...(fallback
      ? {
          fallbackFor: {
            preferred: 'reach' as const,
            because:
              reachSupport === 'not_ingested'
                ? ('not_ingested' as const)
                : ('not_reported' as const),
          },
        }
      : {}),
    definitions: platforms.flatMap((part) =>
      part.inDenominator ? part.definitions : [],
    ),
    window: { from, to },
    platforms,
    crosses: crosses.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** 2026-08-27 as "27 Aug 2026": fixed, so server and browser agree. */
export function formatDenominatorDate(iso: string): string {
  const [year, month, day] = iso.split('-');

  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

const COLUMN_WORDS: Record<DenominatorStamp['column'], string> = {
  views: 'views',
  engaged_views: 'engaged views',
  reach: 'accounts reached',
};

/**
 * The record in words, for the disclosure beside a figure: what it was
 * divided by, over which days, each platform's definitions with the date
 * each began, and every change the window crosses.
 */
export function denominatorSentence(stamp: DenominatorStamp): string {
  const { from, to } = stamp.window;
  // A summary drawn before its period is chosen has no dates to name.
  const sentences = [
    from && to
      ? `Divided by ${COLUMN_WORDS[stamp.column]}, counted from ${formatDenominatorDate(from)} to ${formatDenominatorDate(to)}.`
      : `Divided by ${COLUMN_WORDS[stamp.column]}.`,
  ];

  for (const part of stamp.platforms) {
    const name = PLATFORM_NAMES[part.platform];

    if (!part.inDenominator) {
      sentences.push(
        `${name} is not in the denominator: it reports no single view.`,
      );
      continue;
    }

    if (part.definitions.length === 0) {
      sentences.push(
        `${name} is in the denominator; the days it was counted over could not be read, so which definition of a view it used is not recorded.`,
      );
      continue;
    }

    const counted = part.definitions
      .map((entry) =>
        entry.effectiveFrom
          ? `${entry.label}, since ${formatDenominatorDate(entry.effectiveFrom)}`
          : entry.label,
      )
      .join('; ');

    sentences.push(`${name} counted a view as: ${counted}.`);
  }

  for (const change of stamp.crosses) {
    sentences.push(
      `${PLATFORM_NAMES[change.to.platform]} changed what a view is on ${formatDenominatorDate(change.date)}, inside this window, so the figure counts both.`,
    );
  }

  if (stamp.platforms.length === 0) {
    sentences.push('No platform contributed views to this figure.');
  }

  return sentences.join(' ');
}

/** Engagement rate as the dashboards show it, with its record (FILM-1732). */
export function recordedEngagementRatePercent(
  totals: EngagementCounts & { views: number },
  denominator: DenominatorStamp,
): RecordedRate {
  return { value: displayedEngagementRatePercent(totals), denominator };
}

/**
 * Likes and comments per view, as a percentage, 0 without views: the
 * figure two surfaces label engagement while leaving shares out (KB-171).
 * A second definition, kept as it is so no figure moves; named here so it
 * is recorded rather than recomputed inline.
 */
export function recordedLikesAndCommentsPercent(
  totals: Pick<EngagementCounts, 'likes' | 'comments'> & { views: number },
  denominator: DenominatorStamp,
): RecordedRate {
  const value = ratio(totals.likes + totals.comments, totals.views);

  return { value: value === null ? 0 : value * 100, denominator };
}

/**
 * Revenue per thousand views, in cents: Σrevenue / Σviews × 1000. Null with
 * no views to divide by. The one RPM definition; `pooledRpmCents` and the
 * revenue folds call it.
 */
export function rpmCents(revenueCents: number, views: number): number | null {
  const value = ratio(revenueCents, views);

  return value === null ? null : value * 1000;
}

/**
 * Revenue per view, in cents, with its record: null when no revenue was
 * measured (FILM-1726), 0 without views — the Shorts ROI card's figure.
 */
export function recordedRevenuePerViewCents(
  revenueCents: number | null,
  views: number,
  denominator: DenominatorStamp,
): RecordedRate | null {
  if (revenueCents === null) return null;

  return { value: ratio(revenueCents, views) ?? 0, denominator };
}

/**
 * One record for a figure pooled from figures that each carry one — a
 * project's mean of its seasons' rates: every platform any of them pooled,
 * over the span they cover together. `fallback` when there are none.
 */
export function poolDenominators(
  stamps: readonly DenominatorStamp[],
  fallback: DenominatorWindow,
): DenominatorStamp {
  const froms = stamps.map((stamp) => stamp.window.from).sort();
  const tos = stamps.map((stamp) => stamp.window.to).sort();

  return recordViewsDenominator({
    platforms: stamps.flatMap((stamp) =>
      stamp.platforms.map((part) => part.platform),
    ),
    window: {
      from: froms[0] ?? fallback.from,
      to: tos.at(-1) ?? fallback.to,
    },
  });
}
