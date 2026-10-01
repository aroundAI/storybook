'use server';

import { z } from 'zod';

import type {
  AnalyticsPlatform,
  GenomeAnalysis,
  Recommendation,
  StageMeasureRefusal,
} from '@kit/clickhouse';
import {
  ANALYTICS_PLATFORMS,
  FORMAT_FAMILIES,
  FUNNEL_STAGES,
  analyseGenome,
  metricProvenanceFor,
  recommendFrom,
  stageMeasureFor,
} from '@kit/clickhouse';
import {
  isClickHouseEnabled,
  querySegmentVideoMeasures,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
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
      analysis: GenomeAnalysis;
      /** One per finding, each carrying the finding's evidence. */
      recommendations: Recommendation[];
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

    return {
      status: 'analysed',
      analysis,
      recommendations: analysis.findings.map(recommendFrom),
    };
  },
  { schema: GenomeFindingsSchema, auth: true },
);
