/**
 * Each video's figures for a channel experiment (FILM-1724 §4).
 *
 * Pure. One video, one measure, one checkpoint at a time: first whether
 * the checkpoint can be read at all — FILM-1715's `judgeSubjectCheckpoint`,
 * the same rule the benchmark applies, so "too young", "outside the
 * platform's window" and "predates ingest" mean the same here — then the
 * figure over the video's own first N days, folded by FILM-1610's folds
 * rather than a second copy of their weighting.
 *
 * A video younger than a checkpoint is `pending`; any other absence is
 * `not_measurable` with its reason. Neither is ever a zero.
 */
import type {
  ExperimentMeasure,
  ExperimentVideoInput,
  FormatFamily,
  NotJudgableReason,
  NotMeasurableReason,
  VideoMeasurement,
  ViewsDenominator,
} from '@kit/clickhouse';
import {
  EXPERIMENT_MEASURE_DEFINITIONS,
  HOOK_MAX_DURATION_SECONDS,
  experimentCheckpoints,
  judgeSubjectCheckpoint,
  measurementKey,
  platformIdOfDim,
  resolveAssetDuration,
  resolveFormatFamily,
  viewsDenominatorReason,
} from '@kit/clickhouse';

import type { RetentionPoint } from './retention';
import { retentionAtSeconds } from './retention';
import {
  foldCtr,
  foldNetSubscribers,
  foldViewWeighted,
} from './watched-metrics';

/** What the experiment knows of a video from Postgres, and ClickHouse's rows. */
export interface ExperimentVideoSource {
  publishId: string;
  styleId: string;
  /** The publish as Postgres holds it now. */
  platform: string;
  contentType: string;
  durationSeconds: number | null;
  publishedAt: string;
  /** Absent: the video is not in `video_dim` yet. */
  facts?: {
    publishedAt: string;
    days: Array<{
      ageDays: number;
      views: number;
      engagedViews: number | null;
      avgViewPercentage: number | null;
      subscribersGained: number | null;
      subscribersLost: number | null;
    }>;
    reach: Array<{
      ageDays: number;
      impressions: number;
      impressionsCtr: number;
    }>;
  };
  /** The latest retention curve; absent when none was fetched. */
  curve?: RetentionPoint[];
}

export interface ExperimentMeasureContext {
  formatFamily: FormatFamily;
  measures: readonly ExperimentMeasure[];
  asOf: Date;
  /** The channel's first ingested metric day, or null. */
  channelIngestStart: string | null;
  /**
   * One views series for the whole experiment (FILM-1722), so every
   * style's views are counted under the same definition.
   */
  views: ViewsDenominator;
}

const notMeasurable = (reason: NotMeasurableReason): VideoMeasurement => ({
  state: 'not_measurable',
  reason,
});

/** FILM-1715's verdict on a checkpoint: too young is pending, the rest unmeasurable. */
function fromJudgement(reason: NotJudgableReason): VideoMeasurement {
  return reason.kind === 'too_young'
    ? { state: 'pending', judgableOn: reason.judgableOn }
    : notMeasurable(reason);
}

const NO_DATA = notMeasurable({ kind: 'no_data' });
const NOT_REPORTED = notMeasurable({ kind: 'not_reported_by_platform' });

type Days = NonNullable<ExperimentVideoSource['facts']>['days'];

/** The views of each day under the experiment's series; null if one is unreported. */
function viewsOf(days: Days, views: ViewsDenominator): number[] | null {
  if (views.kind !== 'column') return null;

  const values = days.map((day) =>
    views.column === 'engaged_views' ? day.engagedViews : day.views,
  );

  return values.every((value): value is number => value !== null)
    ? values
    : null;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function measureFirstDays(
  measure: ExperimentMeasure,
  video: ExperimentVideoSource,
  facts: NonNullable<ExperimentVideoSource['facts']>,
  checkpointDays: number,
  context: ExperimentMeasureContext,
): VideoMeasurement {
  const days = facts.days.filter((day) => day.ageDays < checkpointDays);

  switch (measure) {
    case 'views': {
      const reason = viewsDenominatorReason(context.views);
      if (reason) return fromJudgement(reason);

      const views = viewsOf(days, context.views);
      // On an ingested channel a video with no rows earned no views: a
      // real zero, as FILM-1715 counts it.
      return views ? { state: 'measured', value: sum(views) } : NO_DATA;
    }

    case 'ctr': {
      const fold = foldCtr(
        facts.reach.filter((day) => day.ageDays < checkpointDays),
      );

      return fold.status === 'measured'
        ? { state: 'measured', value: fold.value }
        : NO_DATA;
    }

    case 'avg_view_percentage': {
      if (
        days.length > 0 &&
        days.every((day) => day.avgViewPercentage === null)
      ) {
        return NOT_REPORTED;
      }

      const fold = foldViewWeighted(
        days.map((day) => ({ value: day.avgViewPercentage, views: day.views })),
      );

      return fold.status === 'measured'
        ? { state: 'measured', value: fold.value }
        : NO_DATA;
    }

    case 'subscribers_per_1000_views': {
      // A net is gained minus lost, on every day of the window: a day with
      // either unreported (KB-111) leaves the net unknown, not smaller.
      if (
        days.some(
          (day) =>
            day.subscribersGained === null || day.subscribersLost === null,
        )
      ) {
        return NOT_REPORTED;
      }

      const reason = viewsDenominatorReason(context.views);
      if (reason) return fromJudgement(reason);

      const fold = foldNetSubscribers(
        days.map((day) => ({
          gained: day.subscribersGained ?? 0,
          lost: day.subscribersLost,
        })),
      );
      const views = viewsOf(days, context.views);
      const total = views ? sum(views) : 0;

      // No views, no rate: 0 net from 0 views is not "0 per 1,000".
      if (fold.status !== 'measured' || total <= 0) return NO_DATA;

      return { state: 'measured', value: (fold.value / total) * 1000 };
    }

    case 'hook_retention_3s': {
      if (video.platform !== 'youtube') return NOT_REPORTED;

      const duration = resolveAssetDuration(video.durationSeconds);
      if (!duration.known) return notMeasurable({ kind: 'duration_unknown' });
      if (duration.seconds > HOOK_MAX_DURATION_SECONDS) {
        return notMeasurable({
          kind: 'too_long_for_hook',
          seconds: duration.seconds,
        });
      }

      const point = retentionAtSeconds(video.curve ?? [], 3, duration);

      if (point.ok) return { state: 'measured', value: point.retention };

      return notMeasurable(
        point.reason === 'no_curve'
          ? { kind: 'no_curve' }
          : point.reason === 'duration_unknown'
            ? { kind: 'duration_unknown' }
            : { kind: 'too_long_for_hook', seconds: duration.seconds },
      );
    }
  }
}

/** Every measure × checkpoint the experiment reports, for one video. */
export function measureExperimentVideo(
  video: ExperimentVideoSource,
  context: ExperimentMeasureContext,
): ExperimentVideoInput {
  const measurements: Record<string, VideoMeasurement> = {};
  const checkpoints = experimentCheckpoints(context.measures);

  const family = resolveFormatFamily({
    platform: video.platform,
    contentType: video.contentType,
    assetDuration: resolveAssetDuration(video.durationSeconds),
  });
  const platform = platformIdOfDim(video.platform);

  for (const { measure, checkpointDays } of checkpoints) {
    const key = measurementKey(measure, checkpointDays);
    const offered = EXPERIMENT_MEASURE_DEFINITIONS[measure].families;

    // A known duration can move a video out of the family it was assigned
    // in (FILM-1716): it is then not compared with the others.
    if (!family.ok || family.family !== context.formatFamily) {
      measurements[key] = notMeasurable({
        kind: 'format_changed',
        family: family.ok ? family.family : null,
      });
      continue;
    }

    if (offered && !offered.includes(context.formatFamily)) {
      measurements[key] = NOT_REPORTED;
      continue;
    }

    if (!platform) {
      measurements[key] = NOT_REPORTED;
      continue;
    }

    const judged = judgeSubjectCheckpoint({
      platform,
      publishedAt: video.facts?.publishedAt ?? video.publishedAt,
      checkpointDays,
      asOf: context.asOf,
      channelIngestStart: context.channelIngestStart,
    });

    if (!judged.judgable) {
      measurements[key] = fromJudgement(judged.reason);
      continue;
    }

    measurements[key] = video.facts
      ? measureFirstDays(measure, video, video.facts, checkpointDays, context)
      : notMeasurable({ kind: 'not_ingested' });
  }

  return {
    publishId: video.publishId,
    styleId: video.styleId,
    measurements,
  };
}

/** The longest window any chosen measure reads, for the ClickHouse query. */
export function longestCheckpoint(
  measures: readonly ExperimentMeasure[],
): number {
  return Math.max(
    1,
    ...experimentCheckpoints(measures).map((point) => point.checkpointDays),
  );
}

/** What each not-measurable reason means, in words. */
export function notMeasurableText(reason: NotMeasurableReason): string {
  switch (reason.kind) {
    case 'no_data':
      return 'no data for this window';
    case 'not_reported_by_platform':
      return 'not reported by this platform';
    case 'not_ingested':
      return 'not collected yet';
    case 'format_changed':
      return 'no longer in this format';
    case 'duration_unknown':
      return 'video length unknown';
    case 'too_long_for_hook':
      return 'too long for a 3-second point';
    case 'no_curve':
      return 'no retention curve';
    case 'outside_platform_window':
      return "outside the platform's data window";
    case 'platform_stops_updating':
      return 'platform stops updating before this age';
    case 'predates_ingest':
      return 'before analytics collection began';
    case 'nothing_ingested':
      return 'nothing collected for this channel yet';
    case 'view_definition_changed':
      return `view counting changed on ${reason.changedOn}`;
    case 'no_single_view_definition':
      return 'no single view definition';
    case 'not_defined_for_whole_range':
      return `views defined only from ${reason.definedFrom}`;
  }
}
