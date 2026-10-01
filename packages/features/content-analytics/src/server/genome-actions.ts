'use server';

import { z } from 'zod';

import type {
  AnalyticsPlatform,
  CreativeTemplate,
  GenomeAnalysis,
  GenomeHypothesis,
  LinkedTest,
  Recommendation,
  StageMeasureRefusal,
} from '@kit/clickhouse';
import {
  ANALYTICS_PLATFORMS,
  FORMAT_FAMILIES,
  FUNNEL_STAGES,
  analyseGenome,
  applyLinkedTests,
  concludedChangeLogEntry,
  deriveTemplates,
  hypothesesFrom,
  metricProvenanceFor,
  parseGenomeHypothesisKey,
  recommendFrom,
  stageMeasureFor,
} from '@kit/clickhouse';
import {
  isClickHouseEnabled,
  querySegmentVideoMeasures,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { assertScopeAccess } from './scope-access';

const GenomeFindingsSchema = z.object({
  accountId: z.string().uuid(),
  /** One channel: the genome never compares across creators. */
  connectionId: z.string().uuid(),
  /** One format family: a Short's mechanisms are not a long-form video's. */
  formatFamily: z.enum(FORMAT_FAMILIES),
  stage: z.enum(FUNNEL_STAGES),
  checkpointDays: z.number().int().min(1).max(730).default(30),
  control: z.enum(['observed', 'controlled']).default('controlled'),
});

export type GenomeRefusal =
  | StageMeasureRefusal
  | { kind: 'analytics_off' }
  | { kind: 'platform_not_analysed'; platform: string };

export type GenomeFindingsResult =
  | { status: 'refused'; refusal: GenomeRefusal }
  | {
      status: 'analysed';
      /** With every concluded test of its hypotheses applied (v2). */
      analysis: GenomeAnalysis;
      /** One per finding, each carrying the finding's evidence. */
      recommendations: Recommendation[];
      /** What to test next: one per finding not yet causal. */
      hypotheses: GenomeHypothesis[];
      templates: CreativeTemplate[];
    };

function isAnalyticsPlatform(platform: string): platform is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * Which creative mechanisms separate one channel's winners from its
 * comparable losers at one funnel stage (FILM-1717).
 *
 * The figures are FILM-1606's segment query with the stage's measure; the
 * comparison, evidence and claim strengths are `analyseGenome`'s. A stage the
 * platform cannot fill is refused by name, never scored on views instead.
 */
export const getGenomeFindingsAction = enhanceAction(
  async (input): Promise<GenomeFindingsResult> => {
    const scope = {
      accountId: input.accountId,
      connectionId: input.connectionId,
      formatFamily: input.formatFamily,
    };

    // ClickHouse is outside Postgres RLS, so access is proven here or not
    // at all — including that the channel is the account's.
    await assertScopeAccess(scope);

    const client = getSupabaseServerClient();
    const { data: connection, error } = await client
      .from('platform_connections')
      .select('platform')
      .eq('id', input.connectionId)
      .single();

    if (error) {
      throw new Error(`Failed to read the channel: ${error.message}`);
    }

    if (!isAnalyticsPlatform(connection.platform)) {
      return {
        status: 'refused',
        refusal: {
          kind: 'platform_not_analysed',
          platform: connection.platform,
        },
      };
    }

    const platform = connection.platform;
    const measure = stageMeasureFor({
      platform,
      formatFamily: input.formatFamily,
      stage: input.stage,
    });

    if (!measure.ok) {
      return { status: 'refused', refusal: measure.refusal };
    }

    // Off is "cannot measure", not "no videos": an empty analysis would read
    // as a channel with nothing to learn from.
    if (!isClickHouseEnabled()) {
      return { status: 'refused', refusal: { kind: 'analytics_off' } };
    }

    const rows = await querySegmentVideoMeasures({
      scope,
      measure: measure.signal,
      checkpointDays: input.checkpointDays,
      asOf: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    const analysis = analyseGenome({
      videos: rows.flatMap((row) =>
        row.formatFamily === input.formatFamily
          ? [
              {
                videoId: row.videoId,
                connectionId: row.connectionId,
                platform,
                formatFamily: row.formatFamily,
                assetDurationSeconds: row.assetDurationSeconds,
                tags: row.tags,
                value: row.value,
              },
            ]
          : [],
      ),
      stage: input.stage,
      signal: measure.signal,
      checkpointDays: input.checkpointDays,
      control: input.control,
      provenance: metricProvenanceFor(measure.signal, platform),
    });

    // Concluded Change log entries on this channel that tested a genome
    // hypothesis. Paged: the update is wrong if a test is missed. A test on
    // another channel says nothing about this one, as the genome never
    // compares across creators. Channel experiments (FILM-1724) join here
    // once their table exists.
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
          .eq('account_id', input.accountId)
          .eq('connection_id', input.connectionId)
          .eq('status', 'concluded')
          .not('genome_hypothesis', 'is', null)
          .order('id')
          .range(from, to),
      'genome hypothesis tests',
    );

    const tests = tested.flatMap((row): LinkedTest[] => {
      const hypothesis = parseGenomeHypothesisKey(row.genome_hypothesis);
      const backing = concludedChangeLogEntry(row);

      return hypothesis && backing ? [{ hypothesis, backing }] : [];
    });

    const updated = applyLinkedTests(analysis, tests);

    return {
      status: 'analysed',
      analysis: updated,
      recommendations: updated.findings.map(recommendFrom),
      hypotheses: hypothesesFrom(updated),
      templates: deriveTemplates([updated]),
    };
  },
  { schema: GenomeFindingsSchema, auth: true },
);
