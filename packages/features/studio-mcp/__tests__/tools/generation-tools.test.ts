import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  type AnyStageDefinition,
  type Brief,
  type PartSpec,
  storyStage,
} from '@kit/generation';

import { McpToolError } from '../../src/errors';
import type { McpToolDefinition } from '../../src/registry';
import { createGenerationTools } from '../../src/server/tools/generation';
import {
  SUBMISSION_MAX_BYTES,
  jsonBytes,
} from '../../src/server/tools/generation/limits';
import { StageArg } from '../../src/server/tools/generation/schemas';
import { fitBrief } from '../../src/server/tools/generation/service';
import {
  EPISODE_CONTEXT,
  type FakeRunApi,
  FakeRunError,
  createFakeRunApi,
  partsResponders,
} from '../helpers/fake-runs';
import { createFakeClient, fakeContext } from '../helpers/fake-supabase';

const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const EPISODE = {
  id: EPISODE_ID,
  project_id: PROJECT_ID,
  title: 'The Last Signal',
  description: 'A lonely astronaut hears a signal that carries her own voice.',
  version: 3,
  status: 'draft',
  deleted_at: null,
  target_duration_seconds: 300,
  metadata: { content_style: 'dialogue-heavy' },
  project: { id: PROJECT_ID, account_id: ACCOUNT_ID, name: 'P', slug: 'p' },
};

const STORY_TEXT =
  'Maya floats in the silence of the observation deck. '.repeat(40);

function storyOutput() {
  return {
    story: {
      title: 'The Last Signal',
      fullText: STORY_TEXT,
      actBreakdown: { act1: 'Hears.', act2: 'Decodes.', act3: 'Sends.' },
      characters: [
        { name: 'Maya Chen', role: 'protagonist', arc: 'Routine to purpose.' },
      ],
      themes: ['isolation'],
      tone: 'contemplative',
      estimatedSceneCount: 6,
      episodeSummary: 'Maya hears and sends the signal.',
      sentimentScore: 0.6,
      keyEvents: ['Maya hears the signal'],
    },
    canonFacts: {
      threadUpdates: [
        {
          threadName: 'The signal',
          threadType: 'mystery',
          action: 'open',
          description: 'Where it comes from.',
        },
      ],
      episodeSummary: 'Maya receives a signal.',
      sentimentScore: 0.4,
    },
  };
}

/** A two-part stage, to see sequencing, the missing-part refusal and replacing a part. */
const twoPartStage = {
  key: 'screenplay',
  targetType: 'episode',
  targetSchema: z.object({
    episodeId: z.string().uuid(),
    projectId: z.string().uuid(),
    language: z.string().min(2),
  }),
  outputSchema: z.object({ lines: z.array(z.string()).min(1) }),
  async parts() {
    return [1, 2].map(
      (n): PartSpec => ({
        key: `scene:${n}`,
        index: n - 1,
        total: 2,
        label: `Scene ${n}`,
      }),
    );
  },
  async prepare(
    _ctx: unknown,
    _target: unknown,
    part: PartSpec,
    earlier?: readonly unknown[],
  ): Promise<Brief> {
    return {
      stage: 'screenplay',
      part,
      prompt: { slug: 'scene', version: 1, variables: {} },
      instructions: `Write ${part.label}.`,
      context: { earlier: earlier ?? null },
      outputSchema: {},
      constraints: {},
      targetVersion: 3,
      expiresAt: '2026-10-03T13:00:00.000Z',
    };
  },
  async check(_ctx: unknown, _target: unknown, out: { lines: string[] }) {
    return out.lines.includes('BAD')
      ? [{ path: 'lines', code: 'bad_line', message: 'No BAD lines' }]
      : [];
  },
  commit: vi.fn(
    async (
      _ctx: unknown,
      _run: unknown,
      _target: unknown,
      outputs: unknown[],
    ) => ({
      status: 'committed' as const,
      data: { scenes: outputs.length },
    }),
  ),
} as unknown as AnyStageDefinition;

function setup() {
  const runs = createFakeRunApi({
    story: storyStage,
    screenplay: twoPartStage,
  });
  const parts = partsResponders(runs);
  const fake = createFakeClient({
    episodes: [EPISODE],
    projects: [EPISODE.project],
    assets: [],
    accounts: [{ name: 'Ada Owner' }],
    ...parts.responders,
  });
  const tools = createGenerationTools(() => ({
    runs,
    episodeContext: () => async () => EPISODE_CONTEXT,
  }));
  const tool = (name: string) =>
    tools.find((candidate) => candidate.name === name) as McpToolDefinition;
  const call = (name: string, input: Record<string, unknown>) =>
    tool(name).handler(input as never, fakeContext(fake.client));

  return { runs, parts, fake, tools, call };
}

async function rejection(promise: Promise<unknown>): Promise<McpToolError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    return error as McpToolError;
  }
  throw new Error('expected the tool to refuse');
}

const CONTENT_TABLES = [
  'episodes:update',
  'shots',
  'dialogue_lines',
  'audio_cues',
  'narrative_threads',
  'assets:upsert',
];

function contentWrites(fake: ReturnType<typeof createFakeClient>) {
  return fake.calls
    .filter((call) => call.op !== 'select' && call.op !== 'rpc')
    .map((call) => `${call.table}:${call.op}`)
    .filter((key) => CONTENT_TABLES.some((t) => key.startsWith(t)));
}

describe('generation tools (FILM-1908)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('are the seven tools, studio:write but the history, with stage an enum of the registered stages', () => {
    const { tools } = setup();

    expect(tools.map((t) => [t.name, t.scope])).toEqual([
      ['start_generation', 'studio:write'],
      ['get_brief', 'studio:write'],
      ['submit_generation', 'studio:write'],
      ['finalize_generation', 'studio:write'],
      ['get_run', 'studio:write'],
      ['cancel_generation', 'studio:write'],
      ['get_generation_history', 'studio:read'],
    ]);

    const stages = StageArg.options;
    expect(stages).toEqual(
      expect.arrayContaining(['story', 'screenplay', 'shots', 'ideation']),
    );
    // server-only keys have a run but never a brief
    expect(stages).not.toContain('analytics_insights');
    expect(stages).not.toContain('audio_render');

    for (const t of tools) {
      expect(Object.keys(t.inputSchema)).not.toContain('mode');
    }
  });

  it('start_generation opens an external run from the MCP connection and returns the first brief', async () => {
    const { runs, call } = setup();

    const result = (await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    })) as { structuredContent: Record<string, unknown> };

    const { run, brief } = result.structuredContent as unknown as {
      run: { runId: string; mode: string; parts: Array<{ partKey: string }> };
      brief: Brief & { bytes: number };
    };

    expect(run.mode).toBe('external');
    expect(run.parts.map((p) => p.partKey)).toEqual(['story']);
    expect(brief.runId).toBe(run.runId);
    expect(brief.part.key).toBe('story');
    expect(brief.instructions.length).toBeGreaterThan(100);
    expect(brief.targetVersion).toBe(3);
    expect(brief.bytes).toBeLessThan(60 * 1024);

    const opened = runs.runs.get(run.runId)!;
    expect(opened.connectionId).toBe('33333333-3333-4333-8333-333333333333');
    expect(opened.origin).toEqual({
      kind: 'mcp',
      name: 'start_generation',
      clientName: 'test',
    });
    // the story target is the episode's: title, logline, duration, style
    expect(opened.input.target).toMatchObject({
      episodeId: EPISODE_ID,
      projectId: PROJECT_ID,
      title: EPISODE.title,
      logline: EPISODE.description,
      targetDuration: 300,
      contentStyle: 'dialogue-heavy',
    });
    expect(runs.opened[0]!.ctx.runMode()).toBeUndefined();
  });

  it('a second start on the same target and stage is RUN_IN_PROGRESS naming the holder', async () => {
    const { call } = setup();

    const first = (await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    })) as { structuredContent: { run: { runId: string } } };

    const error = await rejection(
      call('start_generation', { stage: 'story', episodeId: EPISODE_ID }),
    );

    expect(error.code).toBe('RUN_IN_PROGRESS');
    expect(error.details?.holder).toMatchObject({
      runId: first.structuredContent.run.runId,
      mode: 'external',
      userName: 'Ada Owner',
      clientName: 'test',
    });
    expect(error.message).toContain('Ada Owner');
  });

  it("start_generation asks for a stage's missing inputs field by field, under options", async () => {
    const { call } = setup();

    const error = await rejection(
      call('start_generation', { stage: 'screenplay', episodeId: EPISODE_ID }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.errors).toEqual([
      expect.objectContaining({ path: 'options.language' }),
    ]);
  });

  it('submit with a missing field returns rejected with that path; the resubmit is accepted and, single-part, committed', async () => {
    const { call, runs, parts, fake } = setup();

    const started = (await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    })) as { structuredContent: { run: { runId: string } } };
    const runId = started.structuredContent.run.runId;

    const bad = storyOutput();
    delete (bad.story as Partial<typeof bad.story>).fullText;

    const rejected = (await call('submit_generation', {
      runId,
      partKey: 'story',
      output: bad,
    })) as { structuredContent: Record<string, unknown> };

    expect(rejected.structuredContent).toEqual({
      status: 'rejected',
      partKey: 'story',
      errors: [expect.objectContaining({ path: 'story.fullText' })],
    });
    expect(runs.finalized).toHaveLength(0);
    expect(contentWrites(fake)).toEqual([]);
    expect(parts.rows[0]!.validation).toMatchObject({ status: 'rejected' });

    const accepted = (await call('submit_generation', {
      runId,
      partKey: 'story',
      output: storyOutput(),
      model: 'claude-opus-5-5',
    })) as { structuredContent: Record<string, unknown> };

    expect(accepted.structuredContent).toMatchObject({
      status: 'accepted',
      partKey: 'story',
      next: null,
      remaining: 0,
      finalized: {
        status: 'committed',
        origin: {
          kind: 'external',
          clientName: 'test',
          model: 'claude-opus-5-5',
          modelSelfReported: true,
        },
      },
    });
    expect(runs.finalized).toEqual([
      { runId, parts: [{ key: 'story', output: storyOutput() }] },
    ]);
    // the failure is kept beside the accepted output, for the history
    expect(parts.rows[0]!.validation).toMatchObject({
      status: 'accepted',
      failures: [
        expect.objectContaining({
          errors: [expect.objectContaining({ path: 'story.fullText' })],
        }),
      ],
    });
  });

  it('an identical retried submit returns the first result and commits once', async () => {
    const { call, runs } = setup();

    const started = (await call('start_generation', {
      stage: 'story',
      episodeId: EPISODE_ID,
    })) as { structuredContent: { run: { runId: string } } };
    const input = {
      runId: started.structuredContent.run.runId,
      partKey: 'story',
      output: storyOutput(),
    };

    const first = (await call('submit_generation', input)) as {
      structuredContent: Record<string, unknown>;
    };
    const retry = (await call('submit_generation', input)) as {
      structuredContent: Record<string, unknown>;
    };

    expect(retry.structuredContent).toMatchObject({
      status: 'accepted',
      partKey: 'story',
      next: null,
      remaining: 0,
      replayed: true,
      finalized: { status: 'committed' },
    });
    expect(first.structuredContent.status).toBe('accepted');
    expect(runs.finalized).toHaveLength(1);

    // a different output on a committed run is refused, not committed again
    const changed = storyOutput();
    changed.story.tone = 'bright';
    const error = await rejection(
      call('submit_generation', { ...input, output: changed }),
    );
    expect(error.code).toBe('RUN_EXPIRED');
    expect(runs.finalized).toHaveLength(1);
  });

  it('parts arrive in order, the next brief comes back, finalize refuses missing parts and commits in stage order', async () => {
    const { call, runs, fake, parts } = setup();

    const started = (await call('start_generation', {
      stage: 'screenplay',
      episodeId: EPISODE_ID,
      options: { language: 'en' },
    })) as { structuredContent: { run: { runId: string }; brief: Brief } };
    const runId = started.structuredContent.run.runId;
    expect(started.structuredContent.brief.part.key).toBe('scene:1');

    const second = (await call('submit_generation', {
      runId,
      partKey: 'scene:2',
      output: { lines: ['two'] },
    })) as { structuredContent: Record<string, unknown> };

    expect(second.structuredContent).toMatchObject({
      status: 'accepted',
      next: { partKey: 'scene:1', index: 0, total: 2 },
      remaining: 1,
      nextBrief: { part: { key: 'scene:1' }, runId },
    });

    const early = await rejection(call('finalize_generation', { runId }));
    expect(early.code).toBe('VALIDATION_FAILED');
    expect(early.details?.errors).toEqual([
      expect.objectContaining({ path: 'parts.scene:1', code: 'missing' }),
    ]);
    // a premature finalize leaves the run open
    expect(runs.runs.get(runId)!.isOpen()).toBe(true);

    // a refused resubmit of an accepted part does not replace it
    const refused = (await call('submit_generation', {
      runId,
      partKey: 'scene:2',
      output: { lines: ['BAD'] },
    })) as { structuredContent: Record<string, unknown> };
    expect(refused.structuredContent).toMatchObject({ status: 'rejected' });

    // an accepted resubmit does
    await call('submit_generation', {
      runId,
      partKey: 'scene:2',
      output: { lines: ['two, again'] },
    });

    const first = (await call('submit_generation', {
      runId,
      partKey: 'scene:1',
      output: { lines: ['one'] },
    })) as { structuredContent: Record<string, unknown> };
    expect(first.structuredContent).toMatchObject({ next: null, remaining: 0 });
    expect(first.structuredContent).not.toHaveProperty('finalized');

    // nothing reached a content table before finalize
    expect(contentWrites(fake)).toEqual([]);
    expect(parts.rows.map((row) => row.part_key).sort()).toEqual([
      'scene:1',
      'scene:2',
    ]);

    const done = (await call('finalize_generation', { runId })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(done.structuredContent).toMatchObject({
      status: 'committed',
      commit: { status: 'committed', data: { scenes: 2 } },
      children: [],
    });
    expect(runs.finalized[0]!.parts).toEqual([
      { key: 'scene:1', output: { lines: ['one'] } },
      { key: 'scene:2', output: { lines: ['two, again'] } },
    ]);

    const again = (await call('finalize_generation', { runId })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(again.structuredContent).toMatchObject({
      status: 'committed',
      alreadyCommitted: true,
    });
    expect(runs.finalized).toHaveLength(1);
  });

  it('a brief carries the parts the run has accepted as earlier, parsed and in part order (KB-178)', async () => {
    const { call } = setup();
    const started = (await call('start_generation', {
      stage: 'screenplay',
      episodeId: EPISODE_ID,
      options: { language: 'en' },
    })) as {
      structuredContent: { run: { runId: string }; brief: Brief };
    };
    const runId = started.structuredContent.run.runId;
    expect(started.structuredContent.brief.context.earlier).toEqual([]);

    const first = (await call('submit_generation', {
      runId,
      partKey: 'scene:1',
      output: { lines: ['one'], ignored: true },
    })) as { structuredContent: { nextBrief: Brief } };
    expect(first.structuredContent.nextBrief.context.earlier).toEqual([
      { lines: ['one'] },
    ]);

    const brief = (await call('get_brief', {
      runId,
      partKey: 'scene:2',
    })) as { structuredContent: { brief: Brief } };
    expect(brief.structuredContent.brief.context.earlier).toEqual([
      { lines: ['one'] },
    ]);

    // the part being briefed is never its own earlier
    const own = (await call('get_brief', {
      runId,
      partKey: 'scene:1',
    })) as { structuredContent: { brief: Brief } };
    expect(own.structuredContent.brief.context.earlier).toEqual([]);
  });

  it('an unknown part is refused with the run’s part keys', async () => {
    const { call } = setup();
    const started = (await call('start_generation', {
      stage: 'screenplay',
      episodeId: EPISODE_ID,
      options: { language: 'en' },
    })) as { structuredContent: { run: { runId: string } } };

    const error = await rejection(
      call('get_brief', {
        runId: started.structuredContent.run.runId,
        partKey: 'scene:9',
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('scene:1, scene:2');
  });

  it('a submission over about 100 KB is VALIDATION_FAILED with a size code, before anything is read', async () => {
    const { call, fake } = setup();
    const output = { lines: ['x'.repeat(SUBMISSION_MAX_BYTES)] };

    const error = await rejection(
      call('submit_generation', {
        runId: 'aaaaaaaa-0000-4000-8000-999999999999',
        partKey: 'scene:1',
        output,
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.errors).toEqual([
      expect.objectContaining({ path: 'output', code: 'too_large' }),
    ]);
    expect(fake.calls).toEqual([]);
  });

  it('a brief over about 60 KB sheds its example, then its rubric, and says so', () => {
    const brief = {
      stage: 'story',
      part: { key: 'story', index: 0, total: 1, label: 'Story' },
      prompt: { slug: 's', version: 1, variables: {} },
      instructions: 'i'.repeat(30 * 1024),
      context: {},
      outputSchema: {},
      example: 'e'.repeat(20 * 1024),
      qualityRubric: 'q'.repeat(20 * 1024),
      constraints: {},
      targetVersion: 1,
      expiresAt: '2026-10-03T13:00:00.000Z',
    } satisfies Brief;

    const fitted = fitBrief(brief);

    expect(fitted.omitted).toEqual(['example']);
    expect(fitted).not.toHaveProperty('example');
    expect(fitted.qualityRubric).toBe(brief.qualityRubric);
    expect(fitted.bytes).toBeLessThan(60 * 1024);
    expect(jsonBytes(fitted)).toBeLessThan(60 * 1024 + 100);
  });

  it('finalize maps TARGET_CHANGED from the run layer', async () => {
    const { call, runs } = setup();
    const started = (await call('start_generation', {
      stage: 'screenplay',
      episodeId: EPISODE_ID,
      options: { language: 'en' },
    })) as { structuredContent: { run: { runId: string } } };
    const runId = started.structuredContent.run.runId;

    for (const partKey of ['scene:1', 'scene:2']) {
      await call('submit_generation', {
        runId,
        partKey,
        output: { lines: [partKey] },
      });
    }

    runs.failNextFinalize = new FakeRunError(
      'TARGET_CHANGED',
      'Episode is at version 4; run was briefed on version 3',
      { runId },
    );

    const error = await rejection(call('finalize_generation', { runId }));
    expect(error.code).toBe('TARGET_CHANGED');
    expect(error.message).toContain('start a new run');
  });

  it('a server run takes no brief or submission over MCP, but can be read and cancelled', async () => {
    const { call, runs } = setup();
    const server = await runs.open(
      'story',
      {
        type: 'episode',
        id: EPISODE_ID,
        accountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        input: { kind: 'stage', target: { episodeId: EPISODE_ID } },
        targetVersion: 3,
      },
      { kind: 'mcp', name: 'web' },
      {
        runMode: () => 'server',
        connectionId: '',
      } as never,
    );
    expect(server.mode).toBe('server');

    const error = await rejection(
      call('submit_generation', {
        runId: server.id,
        partKey: 'story',
        output: storyOutput(),
      }),
    );
    expect(error.code).toBe('FORBIDDEN');

    const read = (await call('get_run', { runId: server.id })) as {
      structuredContent: { run: { mode: string } };
    };
    expect(read.structuredContent.run.mode).toBe('server');

    const cancelled = (await call('cancel_generation', {
      runId: server.id,
    })) as { structuredContent: { cancelled: boolean } };
    expect(cancelled.structuredContent.cancelled).toBe(true);

    const again = (await call('cancel_generation', {
      runId: server.id,
    })) as {
      structuredContent: { cancelled: boolean; run: { status: string } };
    };
    expect(again.structuredContent).toMatchObject({
      cancelled: false,
      run: { status: 'cancelled' },
    });
  });

  it('a run of another team is NOT_FOUND', async () => {
    const { call, runs } = setup();
    const other = await runs.open(
      'story',
      {
        type: 'episode',
        id: EPISODE_ID,
        accountId: '99999999-9999-4999-8999-999999999999',
        projectId: PROJECT_ID,
        input: { kind: 'stage', target: {} },
        targetVersion: 3,
      },
      { kind: 'mcp', name: 'x' },
      { runMode: () => 'external', connectionId: 'c' } as never,
    );

    const error = await rejection(call('get_run', { runId: other.id }));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('get_generation_history returns runs, modes, origins and validation failures', async () => {
    const runRow = {
      id: 'aaaaaaaa-0000-4000-8000-000000000777',
      stage: 'story',
      mode: 'external',
      status: 'committed',
      target_type: 'episode',
      target_id: EPISODE_ID,
      origin: { kind: 'mcp', clientName: 'Claude', model: 'claude-opus-5-5' },
      error: null,
      parent_run_id: null,
      created_by: '11111111-1111-4111-8111-111111111111',
      created_at: '2026-10-03T12:00:00.000Z',
      finalized_at: '2026-10-03T12:05:00.000Z',
      lease_expires_at: null,
    };
    const fake = createFakeClient({
      episodes: [EPISODE],
      generation_runs: (c) =>
        c.filters.some(
          (f) => f.method === 'in' && f.args[0] === 'parent_run_id',
        )
          ? { data: [] }
          : { data: [runRow] },
      generation_run_parts: [
        {
          run_id: runRow.id,
          part_key: 'story',
          output: {},
          validation: {
            status: 'accepted',
            model: 'claude-opus-5-5',
            failures: [
              {
                at: '2026-10-03T12:01:00.000Z',
                errors: [
                  {
                    path: 'story.fullText',
                    code: 'invalid_type',
                    message: 'Required',
                  },
                ],
              },
            ],
          },
          submitted_at: '2026-10-03T12:02:00.000Z',
        },
      ],
    });
    const tools = createGenerationTools(() => ({
      runs: createFakeRunApi({}),
    }));
    const history = tools.find((t) => t.name === 'get_generation_history')!;

    const result = (await history.handler(
      { episodeId: EPISODE_ID, limit: 20 } as never,
      fakeContext(fake.client),
    )) as { structuredContent: Record<string, unknown> };

    expect(result.structuredContent).toEqual({
      episodeId: EPISODE_ID,
      nextCursor: null,
      runs: [
        expect.objectContaining({
          runId: runRow.id,
          stage: 'story',
          mode: 'external',
          status: 'committed',
          origin: runRow.origin,
          children: [],
          parts: [
            {
              partKey: 'story',
              status: 'accepted',
              submittedAt: '2026-10-03T12:02:00.000Z',
              model: 'claude-opus-5-5',
              validationFailures: [
                expect.objectContaining({
                  errors: [expect.objectContaining({ path: 'story.fullText' })],
                }),
              ],
            },
          ],
        }),
      ],
    });
  });
});
