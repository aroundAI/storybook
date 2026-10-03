import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Brief,
  PERFORMANCE_CONTEXT_MAX_BYTES,
  type PerformanceReader,
  type PerformanceReading,
  storyStage,
} from '@kit/generation';

import type { McpToolDefinition } from '../../src/registry';
import { createGenerationTools } from '../../src/server/tools/generation';
import { jsonBytes } from '../../src/server/tools/generation/limits';
import {
  EPISODE_CONTEXT,
  createFakeRunApi,
  partsResponders,
} from '../helpers/fake-runs';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

/**
 * FILM-1912 over MCP: `start_generation` builds the performance block once,
 * before its first brief, on the principal's client and only when the team
 * turned it on; it stores the block on the run, and `get_brief` reads it
 * from the run instead of reading analytics again. The brief stays under
 * the ~60 KB limit with the block at its cap.
 */

const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const EPISODE = {
  id: EPISODE_ID,
  project_id: PROJECT_ID,
  number: 1,
  title: 'The Last Signal',
  description: 'A lonely astronaut hears a signal that carries her own voice.',
  version: 3,
  status: 'draft',
  deleted_at: null,
  duration_seconds: null,
  story_data: null,
  screenplay_data: null,
  target_duration_seconds: 300,
  metadata: { content_style: 'dialogue-heavy' },
  project: { id: PROJECT_ID, account_id: ACCOUNT_ID, name: 'P', slug: 'p' },
};

const HEADING = '## Past performance of this project';

/** Ten YouTube long-form videos of ten episodes. */
function reading(): PerformanceReading {
  return {
    status: 'measured',
    velocityDays: 7,
    videos: Array.from({ length: 10 }, (_, i) => ({
      publishId: `p${i}`,
      episodeId: `${EPISODE_ID.slice(0, -2)}${String(i).padStart(2, '0')}`,
      platform: 'youtube',
      contentType: 'long',
      publishedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      retentionPercent: 30 + i * 3,
      viewsFirstWeek: 100 * (i + 1),
    })),
    window: { mostRecent: 500, truncated: false },
    freshness: [
      { platform: 'youtube', latestDate: '2026-10-01', stale: false },
    ],
    viewDefinitionChanges: [],
  };
}

function fakeReader(value: PerformanceReading, long = ''): PerformanceReader {
  return {
    videos: vi.fn(async () => value),
    genome: vi.fn(async () => ({
      findings: Array.from({ length: long ? 20 : 1 }, () => ({
        platform: 'youtube',
        formatFamily: 'long_horizontal',
        sentence: `Try more cold opens ${long}`,
      })),
      refused: [],
    })),
    concludedExperiments: vi.fn(async () => []),
  };
}

/** A table's rows, with a paged read past its first page answered empty. */
function paged(rows: unknown[]) {
  return (call: RecordedCall) => {
    const range = call.filters.find((filter) => filter.method === 'range');

    return { data: range && Number(range.args[0]) > 0 ? [] : rows };
  };
}

function setup(options: { enabled: boolean; reader: PerformanceReader }) {
  const runs = createFakeRunApi({ story: storyStage });
  const parts = partsResponders(runs);
  const fake = createFakeClient({
    episodes: paged([EPISODE]),
    projects: [EPISODE.project],
    assets: [],
    shots: paged([]),
    accounts: [{ name: 'Ada Owner' }],
    account_ai_settings: [
      {
        account_id: ACCOUNT_ID,
        performance_context_enabled: options.enabled,
      },
    ],
    ...parts.responders,
  });
  const tools = createGenerationTools(() => ({
    runs,
    episodeContext: () => async () => EPISODE_CONTEXT,
    performance: () => options.reader,
  }));
  const call = (name: string, input: Record<string, unknown>) =>
    (
      tools.find((candidate) => candidate.name === name) as McpToolDefinition
    ).handler(input as never, fakeContext(fake.client)) as Promise<{
      structuredContent: Record<string, unknown>;
    }>;

  return { runs, call };
}

describe('the performance block over MCP (FILM-1912)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('start_generation stores the block on the run and briefs with it; get_brief reads it from the run', async () => {
    const reader = fakeReader(reading());
    const { runs, call } = setup({ enabled: true, reader });

    const started = await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    });
    const { run, brief } = started.structuredContent as unknown as {
      run: { runId: string };
      brief: Brief & { bytes: number };
    };

    const stored = runs.runs.get(run.runId)!.input.performanceContext;
    expect(stored).toMatchObject({
      status: 'included',
      stage: 'story',
      projectId: PROJECT_ID,
      retention: { status: 'ranked', sample: 10 },
    });
    expect(brief.context.performanceContext).toEqual(stored);
    expect(brief.instructions).toContain(HEADING);
    expect(brief.prompt.variables.performance_context).toContain(HEADING);
    expect(reader.videos).toHaveBeenCalledTimes(1);

    const again = await call('get_brief', {
      runId: run.runId,
      partKey: 'story',
    });
    const second = (again.structuredContent as { brief: Brief }).brief;

    expect(second.context.performanceContext).toEqual(stored);
    expect(second.instructions).toContain(HEADING);
    // From the run: analytics were read once, at start
    expect(reader.videos).toHaveBeenCalledTimes(1);
  });

  it('with the setting off, stores nothing, briefs without it and reads no analytics', async () => {
    const reader = fakeReader(reading());
    const { runs, call } = setup({ enabled: false, reader });

    const started = await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    });
    const { run, brief } = started.structuredContent as unknown as {
      run: { runId: string };
      brief: Brief;
    };

    expect(runs.runs.get(run.runId)!.input).not.toHaveProperty(
      'performanceContext',
    );
    expect(brief.context).not.toHaveProperty('performanceContext');
    expect(brief.instructions).not.toContain(HEADING);
    expect(brief.prompt.variables.performance_context).toBe('');
    expect(reader.videos).not.toHaveBeenCalled();
  });

  it('keeps the story brief under 60 KB with the block at its cap, dropping nothing', async () => {
    const long = 'x'.repeat(600);
    const { runs, call } = setup({
      enabled: true,
      reader: fakeReader(reading(), long),
    });

    const started = await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    });
    const { run, brief } = started.structuredContent as unknown as {
      run: { runId: string };
      brief: Brief & { bytes: number; omitted?: string[] };
    };

    const stored = runs.runs.get(run.runId)!.input.performanceContext;
    expect(jsonBytes(stored)).toBeLessThanOrEqual(
      PERFORMANCE_CONTEXT_MAX_BYTES,
    );
    expect(brief.bytes).toBeLessThan(60 * 1024);
    expect(brief.omitted).toBeUndefined();
  });
});
