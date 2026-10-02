import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => mockClickHouseClient),
}));

interface QueryCall {
  query: string;
  query_params: Record<string, unknown>;
}

type Responder = (call: QueryCall) => Record<string, unknown>[];

let respond: Responder = () => [];

const mockClickHouseClient = {
  insert: vi.fn(),
  query: vi.fn((call: QueryCall) =>
    Promise.resolve({ json: () => Promise.resolve(respond(call)) }),
  ),
  ping: vi.fn(() => Promise.resolve({ success: true })),
  close: vi.fn(),
  command: vi.fn(),
};

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const ACCOUNT = '550e8400-e29b-41d4-a716-446655440001';
const CHANNEL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const ASOF = new Date('2026-06-01T00:00:00Z');

function isDimLookup(call: QueryCall) {
  return call.query.includes('argMax(account_id, updated_at)');
}

function isCohort(call: QueryCall) {
  return call.query.includes("'all' as cohort");
}

function cohortRow(n: number, median = 200) {
  return {
    cohort: 'all',
    video_count: n,
    median_30: median,
    p25_30: median / 2,
    p75_30: median * 2,
    mean_30: median,
    mature_count_30: n,
    predates_ingest_count_30: 0,
  };
}

/** A YouTube long-form video, published 2026-03-01, one definition throughout. */
function respondWith(input: {
  peersByStep: (call: QueryCall) => number;
  subjectViews?: number;
  ingestStart?: string;
}): Responder {
  return (call) => {
    if (isDimLookup(call)) {
      return [
        {
          account_id: ACCOUNT,
          connection_id: CHANNEL,
          platform: 'youtube',
          content_type: 'full',
          asset_duration_seconds: null,
          language: 'en',
          published_at: '2026-03-01 00:00:00',
        },
      ];
    }
    if (isCohort(call)) return [cohortRow(input.peersByStep(call))];

    return [
      {
        video_id: 'subject',
        age_days: 92,
        ingest_lag_days: 0,
        ingest_start: input.ingestStart ?? '2025-01-01',
        v_30: input.subjectViews ?? 500,
      },
    ];
  };
}

function cohortCalls(): QueryCall[] {
  return mockClickHouseClient.query.mock.calls
    .map(([call]) => call)
    .filter(isCohort);
}

describe('queryVideoBenchmark (FILM-1715)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    respond = () => [];
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
    process.env.CLICKHOUSE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_ENABLED;
  });

  it('compares within the channel and the format family, before this video', async () => {
    respond = respondWith({ peersByStep: () => 20 });
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    const result = await queryVideoBenchmark({
      scope: { projectId: PROJECT },
      videoId: 'subject',
      checkpoints: [30],
      asOf: ASOF,
    });

    const [cohort] = cohortCalls();
    expect(cohort?.query_params).toMatchObject({
      scopeAccountId: ACCOUNT,
      scopeConnectionId: CHANNEL,
      scopeLanguage: 'en',
      cohortPublishedFrom: '2024-03-01 00:00:00',
      cohortPublishedBefore: '2026-03-01 00:00:00',
    });
    expect(cohort?.query_params.scopeFormatDeclared).toContain('youtube:full');
    expect(result).toMatchObject({
      ok: true,
      formatFamily: 'long_horizontal',
      checkpoints: [
        {
          state: 'established',
          band: 'above',
          observedLift: 2.5,
          cohortMedian: 200,
          n: 20,
          relaxedAxes: [],
          viewsColumn: 'views',
        },
      ],
    });
  });

  it('relaxes the window, then language, and never the channel or family', async () => {
    respond = respondWith({
      peersByStep: (call) =>
        call.query_params.scopeLanguage === undefined
          ? 9
          : call.query_params.cohortPublishedFrom === '2024-03-01 00:00:00'
            ? 2
            : 3,
    });
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    const result = await queryVideoBenchmark({
      scope: { projectId: PROJECT },
      videoId: 'subject',
      checkpoints: [30],
      asOf: ASOF,
    });

    const calls = cohortCalls();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.query_params.scopeConnectionId).toBe(CHANNEL);
      expect(call.query_params.scopeFormatDeclared).toBeDefined();
    }
    expect(calls.map((c) => c.query_params.cohortPublishedFrom)).toEqual([
      '2024-03-01 00:00:00',
      '2022-03-01 00:00:00',
      '2022-03-01 00:00:00',
    ]);
    expect(result).toMatchObject({
      ok: true,
      checkpoints: [
        {
          state: 'directional',
          n: 9,
          relaxedAxes: ['window', 'language'],
        },
      ],
    });
  });

  it('stops after the last step and says the peer set is thin', async () => {
    respond = respondWith({ peersByStep: () => 4 });
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    const result = await queryVideoBenchmark({
      scope: { projectId: PROJECT },
      videoId: 'subject',
      checkpoints: [30],
      asOf: ASOF,
    });

    expect(cohortCalls()).toHaveLength(3);
    expect(result).toMatchObject({
      ok: true,
      checkpoints: [
        {
          state: 'insufficient_cohort',
          reason: 'too_few_peers',
          n: 4,
          value: 500,
          relaxedAxes: ['window', 'language'],
        },
      ],
    });
  });

  it('suppresses the video when its own window predates the channel ingest', async () => {
    // Published 2026-03-01, channel ingest from 2026-04-15: a 45-day lag, so
    // @30d closed before the first metric day — the rule that excludes such
    // a video from every cohort excludes it as the subject too.
    respond = respondWith({ peersByStep: () => 20, ingestStart: '2026-04-15' });
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    const result = await queryVideoBenchmark({
      scope: { projectId: PROJECT },
      videoId: 'subject',
      checkpoints: [30],
      asOf: ASOF,
    });

    expect(result).toMatchObject({
      ok: true,
      checkpoints: [
        {
          state: 'not_judgable',
          reason: { kind: 'predates_ingest', ingestLagDays: 45 },
        },
      ],
    });
    expect(cohortCalls()).toHaveLength(0);
  });

  it('reads the video and its peers from the same per-video SQL', async () => {
    respond = respondWith({ peersByStep: () => 20 });
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    await queryVideoBenchmark({
      scope: { projectId: PROJECT },
      videoId: 'subject',
      checkpoints: [30],
      asOf: ASOF,
    });

    const calls = mockClickHouseClient.query.mock.calls.map(([c]) => c);
    const subject = calls.find((c) => !isDimLookup(c) && !isCohort(c));
    const [cohort] = cohortCalls();

    for (const fragment of [
      "dateDiff('day', d.published_at, {asOf: DateTime}) as age_days",
      "greatest(0, dateDiff('day', d.published_at, toDateTime(any(i.ingest_start))))",
      "sumIf(ifNull(m.views, 0), dateDiff('day', d.published_at, toDateTime(m.metric_date)) < 30) as v_30",
    ]) {
      expect(subject?.query).toContain(fragment);
      expect(cohort?.query).toContain(fragment);
    }
    // Both halves read every row: Deep Dive's date-axis rule (FILM-1707 §2)
    // must not reach the peers alone, or a peer and its video differ.
    expect(subject?.query).not.toContain('metric_source !=');
    expect(cohort?.query).not.toContain('metric_source !=');
    expect(subject?.query_params.asOf).toBe(cohort?.query_params.asOf);
  });

  it('reports a missing video, not an empty benchmark', async () => {
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    expect(
      await queryVideoBenchmark({
        scope: { projectId: PROJECT },
        videoId: 'nope',
        asOf: ASOF,
      }),
    ).toEqual({ ok: false, videoId: 'nope', reason: 'video_not_found' });
  });

  it('returns null, not a benchmark, when ClickHouse is off', async () => {
    process.env.CLICKHOUSE_ENABLED = 'false';
    const { queryVideoBenchmark } = await import('../src/queries-advanced');

    expect(
      await queryVideoBenchmark({
        scope: { projectId: PROJECT },
        videoId: 'subject',
      }),
    ).toBeNull();
  });
});

describe('queryCohortMedians ingest start (FILM-1715)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    respond = () => [];
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
    process.env.CLICKHOUSE_ENABLED = 'true';
  });

  it('is the channel’s, not narrowed by language, family or window', async () => {
    const { queryCohortMedians } = await import('../src/queries-advanced');

    await queryCohortMedians({
      scope: {
        projectId: PROJECT,
        language: 'en',
        formatFamily: 'short_vertical',
      },
      bucket: 'all',
      publishedBefore: '2026-03-01 00:00:00',
    });

    const call = mockClickHouseClient.query.mock.calls[0]?.[0];
    const query = call!.query;
    const ingest = query.slice(
      query.indexOf('ingest AS ('),
      query.indexOf('GROUP BY d.connection_id'),
    );

    expect(ingest).not.toContain('FROM dim');
    expect(ingest).not.toContain('HAVING');
    expect(query).toContain('HAVING');
    expect(query).toContain('published_at < {cohortPublishedBefore: DateTime}');
  });

  it('reads engaged views from the table the view selects from', async () => {
    const { queryCohortMedians } = await import('../src/queries-advanced');

    await queryCohortMedians({
      scope: { projectId: PROJECT },
      viewsColumn: 'engaged_views',
      // The benchmark's call: off a date axis, the series picks its table.
      onDateAxis: false,
    });

    const call = mockClickHouseClient.query.mock.calls[0]?.[0];
    expect(call!.query).toContain('sumIf(ifNull(m.engaged_views, 0),');
    expect(call!.query).toContain('FROM video_metrics FINAL');
  });
});
