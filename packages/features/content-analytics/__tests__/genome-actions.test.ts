import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getGenomeFindingsAction } from '../src/server/genome-actions';

/**
 * FILM-1717. The action is the join: scope proven before ClickHouse is read,
 * the stage resolved to FILM-1714's primary signal, the segment rows handed
 * to analyseGenome. Refusals come back as values, so a production build
 * shows them (server-action errors are redacted there).
 */

const ACCOUNT = '550e8400-e29b-41d4-a716-446655440000';
const CHANNEL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const state: {
  calls: string[];
  platform: string;
  clickhouse: boolean;
  measureCalls: Array<{ measure: string; checkpointDays?: number }>;
  rows: Array<Record<string, unknown>>;
  /** analytics_experiments rows the paged read returns. */
  tests: Array<Record<string, unknown>>;
  /** channel_experiments rows (FILM-1724) the paged read returns. */
  channelTests: Array<Record<string, unknown>>;
  /** Filters the experiments reads received, as [method, column, value]. */
  filters: Array<[string, string, unknown]>;
  channelFilters: Array<[string, string, unknown]>;
} = {
  calls: [],
  platform: 'youtube',
  clickhouse: true,
  measureCalls: [],
  rows: [],
  tests: [],
  channelTests: [],
  filters: [],
  channelFilters: [],
};

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: async () => {
    state.calls.push('scope');
    return ACCOUNT;
  },
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      const filters =
        table === 'channel_experiments' ? state.channelFilters : state.filters;
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          if (table !== 'platform_connections') {
            filters.push(['eq', column, value]);
          }
          return builder;
        },
        not: (column: string, operator: string, value: unknown) => {
          filters.push(['not', column, `${operator} ${value}`]);
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => {
          state.calls.push(table);
          const rows =
            table === 'channel_experiments' ? state.channelTests : state.tests;
          return { data: rows.slice(from, to + 1), error: null };
        },
        single: async () => {
          state.calls.push('connection');
          return { data: { platform: state.platform }, error: null };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  isClickHouseEnabled: () => state.clickhouse,
  querySegmentVideoMeasures: async (input: {
    measure: string;
    checkpointDays?: number;
  }) => {
    state.calls.push('clickhouse');
    state.measureCalls.push(input);
    return state.rows;
  },
}));

function row(id: string, value: number | null, tags: string[]) {
  return {
    videoId: id,
    publishedAt: '2026-01-01 00:00:00',
    connectionId: CHANNEL,
    platform: 'youtube',
    formatFamily: 'long_horizontal',
    assetDurationSeconds: 300,
    tags,
    value,
  };
}

const input = {
  accountId: ACCOUNT,
  connectionId: CHANNEL,
  formatFamily: 'long_horizontal' as const,
  stage: 'transmission' as const,
  checkpointDays: 30,
  control: 'controlled' as const,
};

beforeEach(() => {
  state.calls = [];
  state.platform = 'youtube';
  state.clickhouse = true;
  state.measureCalls = [];
  state.tests = [];
  state.channelTests = [];
  state.filters = [];
  state.channelFilters = [];
  state.rows = Array.from({ length: 10 }, (_, index) => {
    const value = (index + 1) / 100;
    return row(`v${index + 1}`, value, [
      'topic:ai',
      index >= 7 ? 'result_first:yes' : 'result_first:no',
    ]);
  });
});

describe('getGenomeFindingsAction', () => {
  it('proves the scope before reading anything, and reads the stage’s own measure', async () => {
    const result = await getGenomeFindingsAction(input);

    expect(state.calls).toEqual([
      'scope',
      'connection',
      'clickhouse',
      'analytics_experiments',
      'channel_experiments',
    ]);
    expect(state.measureCalls[0]).toMatchObject({
      measure: 'share_rate',
      checkpointDays: 30,
    });
    expect(result.status).toBe('analysed');
  });

  it('returns findings, each with a recommendation carrying its evidence', async () => {
    const result = await getGenomeFindingsAction(input);
    if (result.status !== 'analysed') throw new Error(result.status);

    const finding = result.analysis.findings.find(
      (entry) => entry.attribute.tag === 'result_first:yes',
    );
    expect(finding?.evidence.claim.strength).toBe('controlled_association');
    expect(finding?.evidence.provenance.signal).toBe('share_rate');
    expect(result.recommendations).toHaveLength(
      result.analysis.findings.length,
    );
    expect(result.recommendations[0]?.evidence).toBeDefined();
  });

  it('refuses a stage the platform cannot fill, by name, without reading ClickHouse', async () => {
    state.platform = 'tiktok';
    const result = await getGenomeFindingsAction({
      ...input,
      formatFamily: 'short_vertical',
      stage: 'hook',
    });

    expect(result).toMatchObject({
      status: 'refused',
      refusal: { kind: 'stage_unbound' },
    });
    expect(state.calls).not.toContain('clickhouse');
  });

  it('says analytics are off rather than returning an empty analysis', async () => {
    state.clickhouse = false;

    expect(await getGenomeFindingsAction(input)).toEqual({
      status: 'refused',
      refusal: { kind: 'analytics_off' },
    });
  });

  it('refuses a channel on a platform with no analytics', async () => {
    state.platform = 'linkedin';

    expect(await getGenomeFindingsAction(input)).toEqual({
      status: 'refused',
      refusal: { kind: 'platform_not_analysed', platform: 'linkedin' },
    });
  });

  it('drops a row whose format family differs from the one asked for', async () => {
    state.rows.push({
      ...row('short', 9, ['topic:ai', 'result_first:yes']),
      formatFamily: 'short_vertical',
    });
    const result = await getGenomeFindingsAction(input);
    if (result.status !== 'analysed') throw new Error(result.status);

    expect(result.analysis.measuredCount).toBe(10);
  });

  it('reads only this channel’s concluded tests of a genome hypothesis', async () => {
    await getGenomeFindingsAction(input);

    expect(state.filters).toEqual([
      ['eq', 'account_id', ACCOUNT],
      ['eq', 'connection_id', CHANNEL],
      ['eq', 'status', 'concluded'],
      ['not', 'genome_hypothesis', 'is null'],
    ]);
    expect(state.channelFilters).toEqual([
      ['eq', 'account_id', ACCOUNT],
      ['eq', 'connection_id', CHANNEL],
      ['eq', 'status', 'concluded'],
      ['not', 'genome_hypothesis', 'is null'],
    ]);
  });

  it('makes a finding causal from a concluded channel experiment (FILM-1724) whose styles separated', async () => {
    const style = (styleId: string, median: number) => ({
      styleId,
      name: styleId,
      measured: 6,
      pending: 0,
      notMeasurable: 0,
      distribution: { p25: median - 1, median, p75: median + 1 },
      confidence: 'directional',
    });
    state.channelTests = [
      {
        id: 'x1',
        account_id: ACCOUNT,
        connection_id: CHANNEL,
        format_family: 'long_horizontal',
        title: 'Result first or not',
        hypothesis: null,
        expected_outcome: null,
        status: 'concluded',
        started_at: '2026-07-01',
        ended_at: '2026-09-10',
        conclusion: 'Result first wins',
        outcome_status: 'confirmed',
        genome_hypothesis: 'result_first:yes@transmission',
        result_snapshot: {
          version: 1,
          asOf: '2026-09-10T00:00:00.000Z',
          results: [
            {
              measure: 'views',
              checkpointDays: 30,
              styles: [style('first', 50), style('last', 10)],
              verdict: {
                kind: 'compared',
                threshold: 5,
                pairs: [
                  { styleId: 'first', otherStyleId: 'last', relation: 'ahead' },
                  {
                    styleId: 'last',
                    otherStyleId: 'first',
                    relation: 'behind',
                  },
                ],
                anyClearDifference: true,
              },
            },
          ],
        },
        channel_experiment_styles: [
          { id: 'first', name: 'Result first', description: null },
          { id: 'last', name: 'Result last', description: null },
        ],
      },
    ];
    const result = await getGenomeFindingsAction(input);
    if (result.status !== 'analysed') throw new Error(result.status);

    const finding = result.analysis.findings.find(
      (entry) => entry.attribute.tag === 'result_first:yes',
    );
    expect(finding?.evidence.claim).toMatchObject({
      strength: 'causal',
      backing: { kind: 'concluded_channel_experiment', experimentId: 'x1' },
    });
  });

  it('makes a finding causal when a concluded test on this channel confirmed it (v2)', async () => {
    state.tests = [
      {
        id: 'e1',
        status: 'concluded',
        ended_at: '2026-09-01',
        outcome_status: 'confirmed',
        genome_hypothesis: 'result_first:yes@transmission',
      },
      // Malformed keys and unconcluded rows are ignored, never trusted.
      {
        id: 'e2',
        status: 'concluded',
        ended_at: '2026-09-01',
        outcome_status: 'confirmed',
        genome_hypothesis: 'Result First',
      },
    ];
    const result = await getGenomeFindingsAction(input);
    if (result.status !== 'analysed') throw new Error(result.status);

    const finding = result.analysis.findings.find(
      (entry) => entry.attribute.tag === 'result_first:yes',
    );
    expect(finding?.evidence.claim).toMatchObject({
      strength: 'causal',
      backing: { kind: 'change_log', id: 'e1' },
    });
    expect(result.hypotheses.map((h) => h.key)).not.toContain(
      'result_first:yes@transmission',
    );
    expect(result.templates.length).toBeGreaterThan(0);
  });
});
