'use server';

import { z } from 'zod';

import type {
  DenominatorStamp,
  FormatFamily,
  FunnelStage,
  GenomeAnalysis,
  SegmentMeasure,
  StageDiagnosis,
} from '@kit/clickhouse';
import {
  BENCHMARK_CHECKPOINTS,
  benchmarkCheckpointsFor,
  isAnalyticsPlatform,
  metricProvenanceFor,
  recordCohortViewsDenominator,
  stageMeasureFor,
  stageReadings,
} from '@kit/clickhouse';
import type { SegmentVideoMeasureRow } from '@kit/clickhouse/server';
import {
  isClickHouseEnabled,
  querySegmentVideoMeasures,
  queryVideoBenchmark,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllByIds } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type StageSurface,
  type SubjectCheckpoint,
  type SurfaceVideo,
  diagnosisOf,
  stageSurfaceFor,
} from '../lib/signal-surface';
import { genomeFindingsFrom, loadLinkedTests } from './genome-findings';
import { assertScopeAccess } from './scope-access';

const SignalSurfaceSchema = z.object({
  projectId: z.string().uuid(),
  videoId: z.string().min(1).max(200),
  checkpointDays: z.number().int().min(1).max(730).default(30),
});

export type SignalSurfaceResult =
  | { status: 'analytics_off' }
  | {
      status: 'unavailable';
      reason: 'video_not_found' | 'unsupported_platform' | 'unmapped_format';
    }
  | {
      status: 'ok';
      videoId: string;
      platform: string;
      formatFamily: FormatFamily;
      publishedAt: string;
      checkpointDays: number;
      /** The checkpoints this platform's data window allows. */
      checkpoints: number[];
      /** In funnel order. */
      stages: StageSurface[];
      diagnosis: StageDiagnosis;
      /**
       * What each stage's rate divided by, over the days its videos were
       * read (FILM-1732); absent where the stage's measure is not a rate
       * over views.
       */
      denominators: Partial<Record<FunnelStage, DenominatorStamp>>;
      /** FILM-1717's findings at each stage that has a per-video measure. */
      genome: Partial<Record<FunnelStage, GenomeAnalysis>>;
      /** The subject's own tags, so a finding can say whether it carries one. */
      subjectTags: string[];
      videos: Record<string, SurfaceVideo>;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One video's funnel at one checkpoint (FILM-1719): each stage's state, the
 * diagnosis over them, and the genome's findings at the stages it can read.
 *
 * No new query. The subject, its format family and whether the checkpoint
 * can be judged are FILM-1715's `queryVideoBenchmark`; each stage's figures
 * are FILM-1717's `querySegmentVideoMeasures` for that stage's measure,
 * across the subject's channel — the same rows the genome reads, so the
 * strip and the findings cannot disagree about a video's figure.
 */
export const getSignalSurfaceAction = enhanceAction(
  async (input): Promise<SignalSurfaceResult> => {
    // ClickHouse is outside Postgres RLS: the project is proven the
    // caller's here, and every read below is bounded by it.
    const accountId = await assertScopeAccess({ projectId: input.projectId });

    if (!isClickHouseEnabled() || !accountId) {
      return { status: 'analytics_off' };
    }

    const asOf = new Date();
    const benchmark = await queryVideoBenchmark({
      scope: { projectId: input.projectId, accountId },
      videoId: input.videoId,
      checkpoints: [input.checkpointDays],
      asOf,
    });

    if (!benchmark) return { status: 'analytics_off' };
    if (!benchmark.ok)
      return { status: 'unavailable', reason: benchmark.reason };

    const { platform, formatFamily, connectionId, publishedAt } = benchmark;

    if (!isAnalyticsPlatform(platform)) {
      return { status: 'unavailable', reason: 'unsupported_platform' };
    }

    const checkpoint = benchmark.checkpoints[0];
    // The subject's side of the checkpoint. A views-definition refusal is
    // about the views series, not the video's age: the stage measures read
    // their own figures (FILM-1732 owns their denominators).
    const subjectCheckpoint: SubjectCheckpoint =
      checkpoint?.state === 'not_judgable' &&
      checkpoint.reason.kind !== 'view_definition_changed' &&
      checkpoint.reason.kind !== 'no_single_view_definition' &&
      checkpoint.reason.kind !== 'not_defined_for_whole_range'
        ? { judgable: false, reason: checkpoint.reason }
        : { judgable: true };

    const readings = stageReadings(platform, formatFamily);
    const asOfSql = asOf.toISOString().slice(0, 19).replace('T', ' ');

    const measures = new Map<
      SegmentMeasure,
      Promise<SegmentVideoMeasureRow[]>
    >();
    const rowsFor = (signal: SegmentMeasure) => {
      const cached = measures.get(signal);
      if (cached) return cached;

      const promise = querySegmentVideoMeasures({
        scope: { accountId, connectionId },
        measure: signal,
        checkpointDays: input.checkpointDays,
        asOf: asOfSql,
      });
      measures.set(signal, promise);

      return promise;
    };

    const stageRows = await Promise.all(
      readings.map(async (reading) => {
        const measure = stageMeasureFor({
          platform,
          formatFamily,
          stage: reading.stage,
        });

        return measure.ok && reading.status === 'measurable'
          ? { signal: measure.signal, rows: await rowsFor(measure.signal) }
          : null;
      }),
    );

    const stages = readings.map((reading, index) =>
      stageSurfaceFor({
        reading,
        platform,
        subject: {
          videoId: input.videoId,
          publishedAt,
          formatFamily,
          checkpoint: subjectCheckpoint,
        },
        checkpointDays: input.checkpointDays,
        rows: stageRows[index]?.rows ?? [],
        provenanceFor: (signal) => metricProvenanceFor(signal, platform),
      }),
    );

    const client = getSupabaseServerClient();
    const tests = await loadLinkedTests(client, accountId, connectionId);

    const genome: Partial<Record<FunnelStage, GenomeAnalysis>> = {};
    readings.forEach((reading, index) => {
      const measured = stageRows[index];
      if (!measured) return;

      genome[reading.stage] = genomeFindingsFrom({
        rows: measured.rows,
        platform,
        formatFamily,
        stage: reading.stage,
        signal: measured.signal,
        checkpointDays: input.checkpointDays,
        control: 'controlled',
        tests,
      }).analysis;
    });

    // These rates divide by views as read (no bridging here): the record
    // says which definitions that covered, and any change it crossed.
    const denominators: Partial<Record<FunnelStage, DenominatorStamp>> = {};
    readings.forEach((reading, index) => {
      const measured = stageRows[index];
      if (!measured) return;

      const record = recordCohortViewsDenominator({
        platform,
        formatFamily,
        measure: measured.signal,
        publishedAt: measured.rows
          .filter((row) => row.formatFamily === formatFamily)
          .map((row) => row.publishedAt),
        checkpointDays: input.checkpointDays,
        asOf: asOfSql,
        denominator: { column: 'views', publishedFrom: null },
      });
      if (record) denominators[reading.stage] = record;
    });

    const subjectTags =
      stageRows
        .flatMap((measured) => measured?.rows ?? [])
        .find((row) => row.videoId === input.videoId)?.tags ?? [];

    const named = new Set<string>([input.videoId]);
    for (const stage of stages) {
      if (stage.state === 'judged' || stage.state === 'insufficient_cohort') {
        stage.peers.forEach((peer) => named.add(peer.videoId));
      }
    }
    for (const analysis of Object.values(genome)) {
      for (const finding of analysis.findings) {
        finding.evidence.successful.forEach((v) => named.add(v.videoId));
        finding.evidence.unsuccessful.forEach((v) => named.add(v.videoId));
      }
    }

    const publishes = await fetchAllByIds<{
      id: string;
      title: string | null;
      platform_url: string | null;
    }>(
      [...named].filter((id) => UUID.test(id)),
      (chunk, from, to) =>
        client
          .from('publishes')
          .select('id, title, platform_url')
          .in('id', chunk)
          .order('id')
          .range(from, to),
      'signal surface videos',
    );

    const videos: Record<string, SurfaceVideo> = {};
    for (const publish of publishes) {
      videos[publish.id] = { title: publish.title, url: publish.platform_url };
    }

    return {
      status: 'ok',
      videoId: input.videoId,
      platform,
      formatFamily,
      publishedAt,
      checkpointDays: input.checkpointDays,
      checkpoints: benchmarkCheckpointsFor(platform, BENCHMARK_CHECKPOINTS)
        .filter((capability) => capability.judgable)
        .map((capability) => capability.days),
      stages,
      diagnosis: diagnosisOf(
        Object.fromEntries(
          stages.map((stage) => [stage.stage, stage]),
        ) as Record<FunnelStage, StageSurface>,
      ),
      denominators,
      genome,
      subjectTags,
      videos,
    };
  },
  { schema: SignalSurfaceSchema, auth: true },
);
