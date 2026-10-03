import { describe, expect, it, vi } from 'vitest';

import {
  MIN_RANKED_SAMPLE,
  PERFORMANCE_CONTEXT_MAX_BYTES,
  type PerformanceReader,
  type PerformanceReading,
  type PerformanceVideo,
  buildPerformanceContext,
  byteLength,
  episodeTraits,
  performanceContextEnabled,
} from '../src/performance-context';
import { type RecordedCall, recordingClient } from '../src/testing';
import type { Ctx } from '../src/types';

/**
 * FILM-1912: the performance context for a seeded project ranks a
 * hand-computed top and bottom, a thin sample says "not enough data", and
 * with ClickHouse off (or no reader) the block is omitted with its reason.
 */

const PROJECT = '19120000-0000-4000-8000-000000000001';
const ACCOUNT = '19120000-0000-4000-8000-0000000000a1';
const ep = (n: number) =>
  `19120000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

// Ten YouTube long-form videos, one per episode, published five days apart
// from 5 Aug 2026. e5 has not reached day 7's checkpoint (null).
const RETENTION = [50, 62, 41, 70, 55, 38, 66, 47, 59, 44];
const VELOCITY = [900, 300, 1200, 450, null, 800, 150, 1000, 600, 700];

function youtube(n: number): PerformanceVideo {
  return {
    publishId: `pub-yt-${n}`,
    episodeId: ep(n),
    platform: 'youtube',
    contentType: 'long_form',
    publishedAt: `2026-${n <= 5 ? '08' : '09'}-${String(n <= 5 ? n * 5 : (n - 5) * 5 - 1).padStart(2, '0')}T12:00:00Z`,
    retentionPercent: RETENTION[n - 1]!,
    viewsFirstWeek: VELOCITY[n - 1]!,
  };
}

// Three TikTok Shorts of the same episodes, with far more early views: a
// smaller group, never mixed into YouTube's ranking.
function tiktok(n: number): PerformanceVideo {
  return {
    publishId: `pub-tt-${n}`,
    episodeId: ep(n),
    platform: 'tiktok',
    contentType: 'short',
    publishedAt: '2026-09-01T12:00:00Z',
    retentionPercent: null,
    viewsFirstWeek: 99_999,
  };
}

function measured(videos: PerformanceVideo[]): PerformanceReading {
  return {
    status: 'measured',
    velocityDays: 7,
    videos,
    window: { mostRecent: 500, truncated: false },
    freshness: [
      { platform: 'youtube', latestDate: '2026-10-01', stale: false },
    ],
    viewDefinitionChanges: [
      {
        platform: 'youtube',
        date: '2026-08-27',
        from: 'YouTube views (legacy)',
        to: 'YouTube views (2026-08-27)',
      },
    ],
  };
}

function fakeReader(reading: PerformanceReading): PerformanceReader {
  return {
    videos: vi.fn(async () => reading),
    genome: vi.fn(async () => ({
      findings: [
        {
          platform: 'youtube',
          formatFamily: 'long_horizontal',
          sentence:
            'Try more opening: cold open (n=12, associated, observational)',
        },
      ],
      refused: [],
    })),
    concludedExperiments: vi.fn(async () => [
      {
        kind: 'change_log' as const,
        title: 'Cold opens',
        hypothesis: 'A cold open keeps more viewers',
        outcome: 'confirmed',
        endedAt: '2026-09-20',
      },
    ]),
  };
}

const EPISODES = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;

  if (n === 4) {
    return {
      id: ep(4),
      number: 4,
      title: 'The Empty Stage',
      duration_seconds: 120,
      story_data: {
        viralStructure: { openingHook: 'A door opens on an empty stage.' },
      },
      screenplay_data: {
        scenes: [
          { dialogue: [{}, {}] },
          { dialogue: [{}, {}, {}] },
          { dialogue: [{}] },
        ],
      },
    };
  }

  return {
    id: ep(n),
    number: n,
    title: `Episode ${n}`,
    duration_seconds: null,
    story_data: null,
    screenplay_data: null,
  };
});

const SHOTS = [
  ...[4, 6, 5, 5].map((d, i) => ({
    id: `s4-${i}`,
    episode_id: ep(4),
    duration_seconds: d,
  })),
  ...[8, 8].map((d, i) => ({
    id: `s6-${i}`,
    episode_id: ep(6),
    duration_seconds: d,
  })),
];

/** Answers each table from its rows, narrowed by `.in()` and `.eq()`. */
function databaseResponder(
  tables: Record<string, Array<Record<string, unknown>>>,
) {
  return (call: RecordedCall) => {
    const range = call.chain.find((step) => step.method === 'range');
    if (range && Number(range.args[0]) > 0) return { data: [] };

    let rows = tables[call.table] ?? [];

    for (const step of call.chain) {
      if (step.method === 'in') {
        const [column, values] = step.args as [string, unknown[]];
        rows = rows.filter((row) => values.includes(row[column]));
      }
      if (step.method === 'eq') {
        const [column, value] = step.args as [string, unknown];
        if (column !== 'project_id') {
          rows = rows.filter((row) => row[column] === value);
        }
      }
    }

    return {
      data: call.chain.some((step) => step.method === 'maybeSingle')
        ? (rows[0] ?? null)
        : rows,
    };
  };
}

function ctxWith(
  reader: PerformanceReader | undefined,
  tables: Record<string, Array<Record<string, unknown>>> = {
    episodes: EPISODES,
    shots: SHOTS,
  },
) {
  const recording = recordingClient(databaseResponder(tables));
  const ctx: Ctx = {
    client: recording.client,
    accountId: ACCOUNT,
    userId: 'user',
    performance: reader,
  };

  return { ctx, calls: recording.calls };
}

const tenVideos = () => [
  ...Array.from({ length: 10 }, (_, i) => youtube(i + 1)),
  ...[1, 2, 3].map(tiktok),
];

describe('buildPerformanceContext (FILM-1912)', () => {
  it('ranks a hand-computed top and bottom by retention and by velocity, within one platform', async () => {
    const { ctx } = ctxWith(fakeReader(measured(tenVideos())));

    const context = await buildPerformanceContext(ctx, {
      projectId: PROJECT,
      stage: 'story',
    });

    expect(context.status).toBe('included');
    if (context.status !== 'included') return;

    // Retention, highest first: e4 70, e7 66, e2 62 … e10 44, e3 41, e6 38
    expect(context.retention).toMatchObject({
      status: 'ranked',
      group: { platform: 'youtube', contentType: 'long_form' },
      sample: 10,
    });
    if (context.retention.status !== 'ranked') return;
    expect(
      context.retention.top.map((e) => [e.episodeNumber, e.value]),
    ).toEqual([
      [4, 70],
      [7, 66],
      [2, 62],
    ]);
    expect(
      context.retention.bottom.map((e) => [e.episodeNumber, e.value]),
    ).toEqual([
      [6, 38],
      [3, 41],
      [10, 44],
    ]);

    // Velocity: e5 is not yet measured (9 videos); TikTok's 99,999 is
    // another platform's view and stays out. e3 1200, e8 1000, e1 900 …
    // e4 450, e2 300, e7 150
    if (context.velocity.status !== 'ranked') throw new Error('not ranked');
    expect(context.velocity.sample).toBe(9);
    expect(context.velocity.group.platform).toBe('youtube');
    expect(context.velocity.top.map((e) => e.episodeNumber)).toEqual([3, 8, 1]);
    expect(context.velocity.bottom.map((e) => e.episodeNumber)).toEqual([
      7, 2, 4,
    ]);
    expect(context.velocity.measure).toBe(
      'views in the first 7 days after publishing',
    );

    // The top episode's traits, from its stored story, screenplay and shots:
    // 6 lines over 120 s is 3 a minute; shots 4+6+5+5 over 4 is 5 s each
    expect(context.retention.top[0]).toMatchObject({
      title: 'The Empty Stage',
      hook: 'A door opens on an empty stage.',
      sceneCount: 3,
      shotPacing: { shots: 4, meanShotSeconds: 5 },
      dialogueDensity: { lines: 6, linesPerMinute: 3 },
    });
    // No screenplay and no story: null, not zero
    expect(context.retention.bottom[0]).toMatchObject({
      episodeNumber: 6,
      hook: null,
      sceneCount: null,
      dialogueDensity: null,
      shotPacing: { shots: 2, meanShotSeconds: 8 },
    });

    expect(context.sample).toEqual({
      videos: 13,
      mostRecent: 500,
      truncated: false,
    });
    expect(context.label).toContain('2026-10-01');
    expect(context.caveats.join(' ')).toContain('2026-08-27');
    expect(context.genome.findings).toHaveLength(1);
    expect(context.experiments[0]?.title).toBe('Cold opens');
    expect(byteLength(context)).toBeLessThanOrEqual(
      PERFORMANCE_CONTEXT_MAX_BYTES,
    );
  });

  it('asks the genome about the funnel stage the generation stage serves', async () => {
    const reader = fakeReader(measured(tenVideos()));
    const { ctx } = ctxWith(reader);

    await buildPerformanceContext(ctx, {
      projectId: PROJECT,
      stage: 'ideation',
    });
    await buildPerformanceContext(ctx, { projectId: PROJECT, stage: 'shots' });

    expect(vi.mocked(reader.genome).mock.calls).toEqual([
      [PROJECT, 'hook'],
      [PROJECT, 'attention'],
    ]);
  });

  it('says "not enough data" below the minimum sample instead of ranking', async () => {
    const thin = [1, 2, 3, 4, 5].map(youtube);
    const { ctx } = ctxWith(fakeReader(measured(thin)));

    const context = await buildPerformanceContext(ctx, {
      projectId: PROJECT,
      stage: 'shots',
    });

    if (context.status !== 'included') throw new Error('omitted');
    expect(context.retention).toEqual({
      status: 'not_enough_data',
      metric: 'retention',
      measure:
        'average percentage of the video viewed, over its lifetime, as the platform reports it',
      group: { platform: 'youtube', contentType: 'long_form' },
      sample: 5,
      minimum: MIN_RANKED_SAMPLE,
      label:
        'Not enough data to rank by retention: 5 comparable videos (youtube, long_form) measured, at least 8 needed.',
    });
    expect(context.retention).not.toHaveProperty('top');
    expect(context.velocity).toMatchObject({
      status: 'not_enough_data',
      sample: 4,
    });
  });

  it('with ClickHouse off, omits the block with its reason and reads nothing else', async () => {
    const reason =
      'Not measured: ClickHouse is off (CLICKHOUSE_ENABLED=false, production’s state), so past performance is omitted rather than shown as zero.';
    const reader = fakeReader({ status: 'unmeasured', reason });
    const { ctx, calls } = ctxWith(reader);

    const context = await buildPerformanceContext(ctx, {
      projectId: PROJECT,
      stage: 'story',
    });

    expect(context).toEqual({ status: 'omitted', stage: 'story', reason });
    expect(JSON.stringify(context)).not.toMatch(/\b0\b/);
    expect(reader.genome).not.toHaveBeenCalled();
    expect(reader.concludedExperiments).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('with no reader in the runtime, omits the block with its reason', async () => {
    const { ctx } = ctxWith(undefined);

    expect(
      await buildPerformanceContext(ctx, {
        projectId: PROJECT,
        stage: 'ideation',
      }),
    ).toEqual({
      status: 'omitted',
      stage: 'ideation',
      reason:
        'No analytics reader in this runtime, so past performance was not read.',
    });
  });

  it('stays under the size cap when the analytics are long', async () => {
    const long = 'x'.repeat(400);
    const reader: PerformanceReader = {
      ...fakeReader(measured(tenVideos())),
      genome: async () => ({
        findings: Array.from({ length: 20 }, () => ({
          platform: 'youtube',
          formatFamily: 'long_horizontal',
          sentence: long,
        })),
        refused: Array.from({ length: 10 }, () => long),
      }),
      concludedExperiments: async () =>
        Array.from({ length: 20 }, () => ({
          kind: 'change_log' as const,
          title: long,
          hypothesis: long,
          outcome: 'confirmed',
          endedAt: null,
        })),
    };
    const episodes = EPISODES.map((row) => ({
      ...row,
      title: long,
      story_data: { viralStructure: { openingHook: long } },
    }));
    const { ctx } = ctxWith(reader, { episodes, shots: SHOTS });

    const context = await buildPerformanceContext(ctx, {
      projectId: PROJECT,
      stage: 'story',
    });

    expect(context.status).toBe('included');
    expect(byteLength(context)).toBeLessThanOrEqual(
      PERFORMANCE_CONTEXT_MAX_BYTES,
    );
  });

  it('reads only the ranked episodes, and only this project’s', async () => {
    const { ctx, calls } = ctxWith(fakeReader(measured(tenVideos())));

    await buildPerformanceContext(ctx, { projectId: PROJECT, stage: 'story' });

    const episodes = calls.find((call) => call.table === 'episodes')!;
    expect(episodes.chain).toContainEqual({
      method: 'eq',
      args: ['project_id', PROJECT],
    });
    const ids = episodes.chain.find((step) => step.method === 'in')!
      .args[1] as string[];
    // retention top/bottom 4,7,2,6,3,10 and velocity 3,8,1,7,2,4
    expect([...ids].sort()).toEqual([1, 2, 3, 4, 6, 7, 8, 10].map(ep).sort());
  });
});

describe('episodeTraits', () => {
  it('falls back to the shots’ total runtime, and gives no rate without one', () => {
    const screenplay = { scenes: [{ dialogue: [{}, {}, {}] }] };

    expect(
      episodeTraits(
        {
          duration_seconds: null,
          story_data: null,
          screenplay_data: screenplay,
        },
        [30, 30],
      ).dialogueDensity,
    ).toEqual({ lines: 3, linesPerMinute: 3 });

    expect(
      episodeTraits(
        {
          duration_seconds: null,
          story_data: null,
          screenplay_data: screenplay,
        },
        [],
      ),
    ).toEqual({
      hook: null,
      sceneCount: 1,
      shotPacing: null,
      dialogueDensity: { lines: 3, linesPerMinute: null },
    });
  });
});

describe('performanceContextEnabled', () => {
  it('is off for a team with no settings row, and on when the team turned it on', async () => {
    const off = ctxWith(undefined, { account_ai_settings: [] });
    expect(await performanceContextEnabled(off.ctx)).toBe(false);

    const on = ctxWith(undefined, {
      account_ai_settings: [
        { account_id: ACCOUNT, performance_context_enabled: true },
      ],
    });
    expect(await performanceContextEnabled(on.ctx)).toBe(true);
  });
});
