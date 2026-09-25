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
} from './view-definitions';
import { VIEW_DEFINITIONS, viewsDenominatorFor } from './view-definitions';

export type MeasureId =
  | 'engagement_rate'
  | 'share_rate'
  | 'save_rate'
  | 'subscriber_conversion'
  | 'attention_efficiency';

/** A rate over views (or reach). Attention efficiency divides by duration instead. */
export type RateMeasureId = Exclude<MeasureId, 'attention_efficiency'>;

/** Inputs whose support differs by platform. Likes, comments and shares every platform reports. */
export type MeasureInput = 'saves' | 'subscribers_gained' | 'reach';

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
  definitions: readonly ViewDefinition[];
  /** Present when the window crossed a change `engaged_views` bridges. */
  bridged?: {
    reason: 'view_definition_changed';
    changedOn: string;
    changes: readonly ViewDefinitionChange[];
  };
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

/** The numerator of each rate, and the one input each depends on beyond likes/comments/shares. */
const NUMERATOR: Record<
  RateMeasureId,
  {
    of: (counts: MeasureCounts) => number;
    needs?: Exclude<MeasureInput, 'reach'>;
  }
> = {
  engagement_rate: { of: (c) => engagementNumerator(c) },
  share_rate: { of: (c) => c.shares },
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

  const reachCell = MEASURE_INPUT_SUPPORT[platform].reach;
  const isFallback = PREFERRED_DENOMINATOR[platform] === 'reach';

  return {
    kind: 'value',
    measure,
    value,
    denominator: {
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
      definitions: chosen.definitions,
      ...(chosen.instead
        ? {
            bridged: {
              reason: chosen.instead.reason,
              changedOn: chosen.instead.changedOn,
              changes: chosen.instead.changes,
            },
          }
        : {}),
    },
    window: { from, to },
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
