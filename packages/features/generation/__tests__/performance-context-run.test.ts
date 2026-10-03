import { describe, expect, it, vi } from 'vitest';

import {
  type PerformanceReader,
  type PerformanceReading,
  type RunCtx,
  openRun,
  renderPerformanceContext,
  stageCtx,
} from '../src';
import {
  TEST_IDS,
  recordingClient,
  runStoreResponder,
  runStoreState,
} from '../src/testing';

/**
 * FILM-1912 phase 2: the performance block is built once, where the run is
 * opened, on the opener's client and only when the team turned it on; it is
 * stored in `generation_runs.input.performanceContext`, and `stageCtx`
 * hands the stored block to `prepare()`. The worker never builds one.
 */

const UNMEASURED: PerformanceReading = {
  status: 'unmeasured',
  reason: 'Not measured: ClickHouse is off.',
};

function thinReading(): PerformanceReading {
  return {
    status: 'measured',
    velocityDays: 7,
    videos: [1, 2, 3].map((n) => ({
      publishId: `p${n}`,
      episodeId: `e${n}`,
      platform: 'youtube',
      contentType: 'long',
      publishedAt: `2026-09-0${n}T00:00:00Z`,
      retentionPercent: 40 + n,
      viewsFirstWeek: 100 * n,
    })),
    window: { mostRecent: 500, truncated: false },
    freshness: [
      { platform: 'youtube', latestDate: '2026-10-01', stale: false },
    ],
    viewDefinitionChanges: [],
  };
}

function readerOf(reading: PerformanceReading): PerformanceReader {
  return {
    videos: vi.fn(async () => reading),
    genome: vi.fn(async () => ({ findings: [], refused: [] })),
    concludedExperiments: vi.fn(async () => []),
  };
}

function harness(options: { enabled?: boolean; reader?: PerformanceReader }) {
  const state = runStoreState([]);

  if (options.enabled !== undefined) {
    state.settings.set(TEST_IDS.account, {
      server_generation_enabled: true,
      external_generation_enabled: true,
      default_mode: 'server',
      performance_context_enabled: options.enabled,
    });
  }

  const recording = recordingClient(runStoreResponder(state));
  state.client = recording.client;

  const ctx: RunCtx = {
    client: recording.client,
    accountId: TEST_IDS.account,
    userId: TEST_IDS.user,
    performance: options.reader,
  };

  return { state, ctx };
}

const jobTarget = {
  type: 'episode' as const,
  id: TEST_IDS.episode,
  accountId: TEST_IDS.account,
  projectId: TEST_IDS.project,
  input: {
    kind: 'job' as const,
    jobType: 'story-generation' as const,
    payload: { episodeId: TEST_IDS.episode },
  },
};

const origin = { kind: 'web' as const, name: 'test.open' };

function storedInput(state: ReturnType<typeof runStoreState>) {
  const open = state.rpcs.find((rpc) => rpc.fn === 'open_generation_run');
  return (open?.args as { p_input: Record<string, unknown> }).p_input;
}

describe('openRun stores the performance block (FILM-1912)', () => {
  it('builds it once on the opener’s reader and stores it on the run when the team has it on', async () => {
    const reader = readerOf(thinReading());
    const { ctx, state } = harness({ enabled: true, reader });

    const run = await openRun('story', jobTarget, origin, ctx);

    const block = storedInput(state).performanceContext as Record<
      string,
      unknown
    >;
    expect(block).toMatchObject({
      status: 'included',
      stage: 'story',
      projectId: TEST_IDS.project,
      retention: { status: 'not_enough_data', sample: 3, minimum: 8 },
    });
    expect(reader.videos).toHaveBeenCalledTimes(1);
    expect(reader.videos).toHaveBeenCalledWith(TEST_IDS.project);
    expect(run.input.performanceContext).toEqual(block);
  });

  it('stores the omission and its reason when ClickHouse is off, not zeros', async () => {
    const { ctx, state } = harness({
      enabled: true,
      reader: readerOf(UNMEASURED),
    });

    await openRun('ideation', jobTarget, origin, ctx);

    expect(storedInput(state).performanceContext).toEqual({
      status: 'omitted',
      stage: 'ideation',
      reason: UNMEASURED.reason,
    });
  });

  it('stores nothing and reads nothing when the team has it off, or has no settings row', async () => {
    for (const enabled of [false, undefined]) {
      const reader = readerOf(thinReading());
      const { ctx, state } = harness({ enabled, reader });

      await openRun('shots', jobTarget, origin, ctx);

      expect(storedInput(state)).not.toHaveProperty('performanceContext');
      expect(reader.videos).not.toHaveBeenCalled();
    }
  });

  it('stores nothing for a stage that takes no block, or an opener with no reader', async () => {
    const reader = readerOf(thinReading());
    const refinement = harness({ enabled: true, reader });

    await openRun('story_refinement', jobTarget, origin, refinement.ctx);

    expect(storedInput(refinement.state)).not.toHaveProperty(
      'performanceContext',
    );
    expect(reader.videos).not.toHaveBeenCalled();

    const worker = harness({ enabled: true });
    await openRun('story', jobTarget, origin, worker.ctx);
    expect(storedInput(worker.state)).not.toHaveProperty('performanceContext');
  });

  it('keeps a block the opener already built (MCP builds it for its first brief) and reads nothing again', async () => {
    const reader = readerOf(thinReading());
    const { ctx, state } = harness({ enabled: true, reader });
    const built = { status: 'omitted', stage: 'story', reason: 'built first' };

    await openRun(
      'story',
      {
        ...jobTarget,
        input: {
          kind: 'stage',
          target: {},
          performanceContext: built as never,
        },
      },
      origin,
      ctx,
    );

    expect(storedInput(state).performanceContext).toEqual(built);
    expect(reader.videos).not.toHaveBeenCalled();
  });
});

describe('a failed analytics read never stops a run from opening', () => {
  it('opens the run with the failure stored as the block’s reason', async () => {
    const reader = readerOf(UNMEASURED);
    vi.mocked(reader.videos).mockRejectedValue(new Error('the read timed out'));
    const { ctx, state } = harness({ enabled: true, reader });

    const run = await openRun('shots', jobTarget, origin, ctx);

    expect(run.status).toBe('briefed');
    expect(storedInput(state).performanceContext).toEqual({
      status: 'omitted',
      stage: 'shots',
      reason: 'Past performance could not be read: the read timed out',
    });
  });
});

describe('stageCtx hands the stored block to prepare()', () => {
  it('sets ctx.performanceContext from the run, and leaves it unset when the run has none', async () => {
    const reader = readerOf(thinReading());
    const on = harness({ enabled: true, reader });
    const run = await openRun('story', jobTarget, origin, on.ctx);

    // The worker's context carries no reader: it only reads the run
    const workerCtx = { ...on.ctx, performance: undefined };

    expect(stageCtx(run, workerCtx).performanceContext).toEqual(
      run.input.performanceContext,
    );
    expect(stageCtx(run, workerCtx).performanceContext?.status).toBe(
      'included',
    );

    const off = harness({ enabled: false, reader });
    const plain = await openRun('story', jobTarget, origin, off.ctx);
    expect(stageCtx(plain, off.ctx).performanceContext).toBeUndefined();
  });
});

describe('renderPerformanceContext', () => {
  it('renders nothing without a block or for an omitted one, so prompts are unchanged', () => {
    expect(renderPerformanceContext(undefined)).toBe('');
    expect(
      renderPerformanceContext({
        status: 'omitted',
        stage: 'story',
        reason: 'off',
      }),
    ).toBe('');
  });

  it('renders an included block under its own heading, with its label', async () => {
    const { ctx, state } = harness({
      enabled: true,
      reader: readerOf(thinReading()),
    });
    const run = await openRun('story', jobTarget, origin, ctx);
    const text = renderPerformanceContext(run.input.performanceContext);

    expect(text.startsWith('\n\n## Past performance of this project')).toBe(
      true,
    );
    expect(text).toContain("Past performance of this project's 3 published");
    expect(text).toContain('"not_enough_data"');
    expect(storedInput(state).performanceContext).toBeDefined();
  });
});
