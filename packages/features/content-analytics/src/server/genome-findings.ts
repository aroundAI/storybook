import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AnalyticsPlatform,
  CreativeTemplate,
  EditStyleFigures,
  FormatFamily,
  FunnelStage,
  GenomeAnalysis,
  GenomeHypothesis,
  LinkedTest,
  Recommendation,
  SegmentMeasure,
} from '@kit/clickhouse';
import {
  analyseGenome,
  applyLinkedTests,
  concludedChangeLogEntry,
  deriveTemplates,
  hypothesesFrom,
  metricProvenanceFor,
  parseGenomeHypothesisKey,
  recommendFrom,
  toConcludedChannelExperiment,
} from '@kit/clickhouse';
import type { SegmentVideoMeasureRow } from '@kit/clickhouse/server';
import { fetchAllRows } from '@kit/shared/pagination';

// The same loose client type the action modules use; the typed client's
// generics do not survive being passed around.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface GenomeFindings {
  /** With every concluded test of its hypotheses applied (v2). */
  analysis: GenomeAnalysis;
  /** One per finding, each carrying the finding's evidence. */
  recommendations: Recommendation[];
  /** What to test next: one per finding not yet causal. */
  hypotheses: GenomeHypothesis[];
  templates: CreativeTemplate[];
}

/**
 * Concluded tests on this channel that tested a genome hypothesis: Change
 * log entries (FILM-1610) and channel experiments (FILM-1724). Paged: the
 * update is wrong if a test is missed. A test on another channel says
 * nothing about this one, as the genome never compares across creators.
 *
 * Shared by the genome action and the Signal Surface (FILM-1719), so both
 * read the same tests.
 */
export async function loadLinkedTests(
  client: Client,
  accountId: string,
  connectionId: string,
): Promise<LinkedTest[]> {
  const tested = await fetchAllRows<{
    id: string;
    status: string;
    ended_at: string | null;
    outcome_status: string;
    genome_hypothesis: string | null;
  }>(
    (from, to) =>
      client
        .from('analytics_experiments')
        .select('id, status, ended_at, outcome_status, genome_hypothesis')
        .eq('account_id', accountId)
        .eq('connection_id', connectionId)
        .eq('status', 'concluded')
        .not('genome_hypothesis', 'is', null)
        .order('id')
        .range(from, to),
    'genome hypothesis tests',
  );

  const channelTested = await fetchAllRows<{
    id: string;
    account_id: string;
    connection_id: string;
    format_family: string;
    title: string;
    hypothesis: string | null;
    expected_outcome: string | null;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    conclusion: string | null;
    outcome_status: string;
    result_snapshot: unknown;
    genome_hypothesis: string | null;
    channel_experiment_styles: {
      id: string;
      name: string;
      description: string | null;
    }[];
  }>(
    (from, to) =>
      client
        .from('channel_experiments')
        .select(
          'id, account_id, connection_id, format_family, title, hypothesis, expected_outcome, status, started_at, ended_at, conclusion, outcome_status, result_snapshot, genome_hypothesis, channel_experiment_styles(id, name, description)',
        )
        .eq('account_id', accountId)
        .eq('connection_id', connectionId)
        .eq('status', 'concluded')
        .not('genome_hypothesis', 'is', null)
        .order('id')
        .range(from, to),
    'genome hypothesis channel experiments',
  );

  return [
    ...tested.flatMap((row): LinkedTest[] => {
      const hypothesis = parseGenomeHypothesisKey(row.genome_hypothesis);
      const backing = concludedChangeLogEntry(row);

      return hypothesis && backing ? [{ hypothesis, backing }] : [];
    }),
    ...channelTested.flatMap((row): LinkedTest[] => {
      const hypothesis = parseGenomeHypothesisKey(row.genome_hypothesis);
      // Null unless concluded with the results the table froze: a
      // running experiment's associations never back a claim.
      const backing = toConcludedChannelExperiment({
        ...row,
        styles: row.channel_experiment_styles,
      });

      return hypothesis && backing ? [{ hypothesis, backing }] : [];
    }),
  ];
}

/**
 * Which creative mechanisms separate one channel's winners from its
 * comparable losers at one stage, from the segment query's per-video rows
 * for the stage's measure. The comparison, evidence and claim strengths are
 * `analyseGenome`'s; concluded tests then update the claims (v2).
 */
export function genomeFindingsFrom(input: {
  rows: readonly SegmentVideoMeasureRow[];
  platform: AnalyticsPlatform;
  formatFamily: FormatFamily;
  stage: FunnelStage;
  signal: SegmentMeasure;
  checkpointDays: number;
  control: 'observed' | 'controlled';
  tests: readonly LinkedTest[];
  /**
   * Each video's edit style from a delivered StorybookStudio session
   * (FILM-2006), keyed by video id; a video absent from it gains no
   * edit-style attribute.
   */
  editStyles?: ReadonlyMap<string, EditStyleFigures>;
}): GenomeFindings {
  const analysis = analyseGenome({
    videos: input.rows.flatMap((row) =>
      row.formatFamily === input.formatFamily
        ? [
            {
              videoId: row.videoId,
              connectionId: row.connectionId,
              platform: input.platform,
              formatFamily: row.formatFamily,
              assetDurationSeconds: row.assetDurationSeconds,
              tags: row.tags,
              value: row.value,
              editStyle: input.editStyles?.get(row.videoId) ?? null,
            },
          ]
        : [],
    ),
    stage: input.stage,
    signal: input.signal,
    checkpointDays: input.checkpointDays,
    control: input.control,
    provenance: metricProvenanceFor(input.signal, input.platform),
  });

  const updated = applyLinkedTests(analysis, input.tests);

  return {
    analysis: updated,
    recommendations: updated.findings.map(recommendFrom),
    hypotheses: hypothesesFrom(updated),
    templates: deriveTemplates([updated]),
  };
}
