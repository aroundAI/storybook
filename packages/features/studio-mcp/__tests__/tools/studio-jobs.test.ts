import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalizationStart } from '@kit/audio-generation/server/localize-starts';
import { SHOT_REGENERATION_MAX, shotsStage } from '@kit/generation';

import {
  episodeFixture,
  fixtureEpisodeContext,
  shotsOutput,
} from '../../../generation/src/testing/part-d';
import type { McpToolDefinition } from '../../src/registry';
import { createGenerationTools } from '../../src/server/tools/generation';
import {
  type StudioJobDeps,
  createStudioJobTools,
} from '../../src/server/tools/studio/jobs';
import { createFakeRunApi, partsResponders } from '../helpers/fake-runs';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

/**
 * FILM-2007's tools against FILM-1903's run layer in memory and the real
 * shots stage on FILM-1901 part D's fixture episode: regenerate_shots opens
 * an external run whose parts (and briefs) are only the listed shots, queues
 * those shots and clears their video as the caller, and finalize writes the
 * re-plan in place; localize_episode validates its languages and maps the
 * start's refusals to the error contract.
 */
const EPISODE_ID = episodeFixture.ids.episodeId;
const SHOT = (n: number) => `5a0700${n}0-0000-4000-8000-000000000000`;

function shotRow(n: number, status = 'completed') {
  return {
    id: SHOT(n),
    scene_number: n <= 2 ? 1 : 2,
    shot_number: n,
    sequence_number: n,
    scene_description: `Shot ${n} as planned`,
    prompt: `old prompt ${n}`,
    duration_seconds: 6,
    camera_direction: 'static',
    transition_type: 'cut',
    first_frame_description: null,
    last_frame_description: null,
    status,
    video_url: `https://cdn.test/episodes/${EPISODE_ID}/shot-${n}.mp4`,
    generation_metadata: { veoPrompt: { fullPrompt: `old prompt ${n}` } },
  };
}

function filter(call: RecordedCall, method: string, column: string) {
  return call.filters.find((f) => f.method === method && f.args[0] === column)
    ?.args[1];
}

function setup(
  options: {
    shots?: ReturnType<typeof shotRow>[];
    canWrite?: boolean;
    localize?: StudioJobDeps['localize'];
  } = {},
) {
  const shots = options.shots ?? [1, 2, 3, 4].map((n) => shotRow(n));
  const runs = createFakeRunApi({ shots: shotsStage });
  const parts = partsResponders(runs);
  const fake = createFakeClient({
    episodes: [
      { ...episodeFixture.episode, project_id: episodeFixture.ids.projectId },
    ],
    'rpc:can_write_project': options.canWrite ?? true,
    shots: (call) => {
      if (call.op === 'update') {
        const id = filter(call, 'eq', 'id');
        const shot = shots.find((row) => row.id === id);

        return {
          data: shot && shot.status !== 'generating' ? [{ id: shot.id }] : [],
        };
      }

      const ids = filter(call, 'in', 'id') as string[] | undefined;
      const sequences = filter(call, 'in', 'sequence_number') as
        | number[]
        | undefined;

      if (ids) return { data: shots.filter((row) => ids.includes(row.id)) };

      if (sequences) {
        return {
          data: shots.filter((row) => sequences.includes(row.sequence_number)),
        };
      }

      return { data: shots };
    },
    ...parts.responders,
  });
  const generation = () => ({
    runs,
    episodeContext: () => fixtureEpisodeContext,
  });
  const localize =
    options.localize ??
    vi.fn(async () => ({
      episodeId: EPISODE_ID,
      translationRunId: null,
      jobs: [],
    }));
  const jobTools = createStudioJobTools({ generation, localize });
  const tools = [
    ...createGenerationTools(generation),
    jobTools.regenerateShotsTool,
    jobTools.localizeEpisodeTool,
  ] as unknown as McpToolDefinition[];
  const call = (name: string, input: Record<string, unknown>) =>
    tools
      .find((tool) => tool.name === name)!
      .handler(input as never, fakeContext(fake.client));

  return { call, fake, runs, localize };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; details?: unknown };
  }

  throw new Error('expected a refusal');
}

const sceneShot = shotsOutput.scenes[0]!.shots[0]!;

describe('regenerate_shots (FILM-2007)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it(`refuses more than ${SHOT_REGENERATION_MAX} shots, and a shot listed twice, with VALIDATION_FAILED and no run`, async () => {
    const { call, runs } = setup();
    const many = Array.from(
      { length: SHOT_REGENERATION_MAX + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );

    const tooMany = await refusal(
      call('regenerate_shots', {
        episodeId: EPISODE_ID,
        shotIds: many,
        reason: 'too dark',
      }),
    );
    const twice = await refusal(
      call('regenerate_shots', {
        episodeId: EPISODE_ID,
        shotIds: [SHOT(1), SHOT(1)],
        reason: 'too dark',
      }),
    );

    expect(tooMany).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(tooMany.message).toContain(`At most ${SHOT_REGENERATION_MAX}`);
    expect(twice).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(runs.opened).toHaveLength(0);
  });

  it('refuses a shot that is generating with RUN_IN_PROGRESS, before any run or write', async () => {
    const { call, runs, fake } = setup({
      shots: [shotRow(1), shotRow(2, 'generating')],
    });

    const error = await refusal(
      call('regenerate_shots', {
        episodeId: EPISODE_ID,
        shotIds: [SHOT(1), SHOT(2)],
        reason: 'too dark',
      }),
    );

    expect(error).toMatchObject({
      code: 'RUN_IN_PROGRESS',
      details: { shotIds: [SHOT(2)] },
    });
    expect(runs.opened).toHaveLength(0);
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('refuses a reader who cannot write the project (FORBIDDEN), and a shot not in the episode (NOT_FOUND)', async () => {
    const viewer = setup({ canWrite: false });
    const forbidden = await refusal(
      viewer.call('regenerate_shots', {
        episodeId: EPISODE_ID,
        shotIds: [SHOT(1)],
        reason: 'too dark',
      }),
    );

    expect(forbidden).toMatchObject({ code: 'FORBIDDEN' });

    const { call } = setup();
    const missing = await refusal(
      call('regenerate_shots', {
        episodeId: EPISODE_ID,
        shotIds: [SHOT(1), SHOT(9)],
        reason: 'too dark',
      }),
    );

    expect(missing).toMatchObject({
      code: 'NOT_FOUND',
      details: { shotIds: [SHOT(9)] },
    });
  });

  it('opens an external run whose brief lists only the given shots, queues them and clears their video', async () => {
    const { call, runs, fake } = setup();

    const result = (await call('regenerate_shots', {
      episodeId: EPISODE_ID,
      shotIds: [SHOT(3), SHOT(1)],
      reason: 'The car park reads as daytime',
    })) as {
      structuredContent: {
        runId: string;
        mode: string;
        run: { parts: Array<{ partKey: string }>; origin: { name: string } };
        brief: { part: { key: string }; context: Record<string, unknown> };
      };
    };
    const { structuredContent: out } = result;

    expect(out.mode).toBe('external');
    expect(out.run.origin.name).toBe('regenerate_shots');
    expect(out.run.parts.map((p) => p.partKey)).toEqual([
      `shot:${SHOT(1)}`,
      `shot:${SHOT(3)}`,
    ]);
    expect(out.brief.part.key).toBe(`shot:${SHOT(1)}`);
    expect(out.brief.context.scenes).toHaveLength(1);
    expect(runs.runs.get(out.runId)!.input.target).toMatchObject({
      regenerate: {
        shotIds: [SHOT(3), SHOT(1)],
        reason: 'The car park reads as daytime',
      },
    });

    const queued = fake.calls.filter(
      (c) => c.table === 'shots' && c.op === 'update',
    );

    expect(queued.map((c) => filter(c, 'eq', 'id'))).toEqual([
      SHOT(1),
      SHOT(3),
    ]);
    expect(queued[0]!.payload).toMatchObject({
      status: 'queued',
      video_url: null,
      generation_metadata: {
        veoPrompt: { fullPrompt: 'old prompt 1' },
        regeneration: {
          reason: 'The car park reads as daytime',
          runId: out.runId,
          previousStatus: 'completed',
          previousVideoUrl: `https://cdn.test/episodes/${EPISODE_ID}/shot-1.mp4`,
        },
      },
    });
    expect(queued[0]!.filters).toContainEqual({
      method: 'neq',
      args: ['status', 'generating'],
    });

    // A second re-plan of the episode while this one is open waits
    const second = await refusal(
      call('regenerate_shots', {
        episodeId: EPISODE_ID,
        shotIds: [SHOT(2)],
        reason: 'again',
      }),
    );

    expect(second).toMatchObject({ code: 'RUN_IN_PROGRESS' });
  });

  it('finalize writes the re-plan in place and touches the episode: no delete, no insert, no status', async () => {
    const { call, runs, fake } = setup();
    const started = (await call('regenerate_shots', {
      episodeId: EPISODE_ID,
      shotIds: [SHOT(1)],
      reason: 'too dark',
    })) as { structuredContent: { runId: string } };
    const runId = started.structuredContent.runId;
    const before = fake.calls.length;

    const submitted = (await call('submit_generation', {
      runId,
      partKey: `shot:${SHOT(1)}`,
      output: { ...sceneShot, kind: 'shot', shotId: SHOT(1) },
    })) as {
      structuredContent: { status: string; finalized?: { status: string } };
    };

    // One shot is a single-part run: it commits on acceptance
    expect(submitted.structuredContent.status).toBe('accepted');
    expect(submitted.structuredContent.finalized?.status).toBe('committed');
    expect(runs.commits[0]).toMatchObject({
      status: 'committed',
      data: { regeneratedShotIds: [SHOT(1)] },
    });

    const writes = fake.calls
      .slice(before)
      .filter((c) => c.op !== 'select' && c.op !== 'rpc');

    expect(writes.map((c) => [c.table, c.op])).toEqual([
      ['shots', 'update'],
      ['episodes', 'update'],
    ]);
    expect(writes[0]!.payload).toMatchObject({
      prompt: sceneShot.veoPrompt.fullPrompt,
    });
    expect(writes[0]!.payload).not.toHaveProperty('status');
    expect(writes[0]!.payload).not.toHaveProperty('video_url');
  });
});

describe('localize_episode (FILM-2007)', () => {
  it.each([
    [['pt-BR'], 'use pt'],
    [['en'], 'en is the language the dialogue is written in'],
    [['xx'], 'xx is not a language StoryBook can voice'],
    [['HI'], 'use hi'],
    [['hi', 'hi'], 'hi is listed twice'],
  ])('refuses %j: %s', async (languages, message) => {
    const { call, localize } = setup();

    const error = await refusal(
      call('localize_episode', { episodeId: EPISODE_ID, languages }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(error.details)).toContain(message);
    expect(localize).not.toHaveBeenCalled();
  });

  it('starts every language as the caller and returns a job per language', async () => {
    const start: LocalizationStart = {
      episodeId: EPISODE_ID,
      translationRunId: 'aaaaaaaa-0000-4000-8000-0000000000aa',
      jobs: [
        {
          language: 'es',
          dubbedVersionId: 'bbbbbbbb-0000-4000-8000-0000000000bb',
          status: 'translating',
          lines: 4,
          estimatedCost: 1,
        },
      ],
    };
    const localize = vi.fn(async () => start);
    const { call } = setup({ localize });

    const result = (await call('localize_episode', {
      episodeId: EPISODE_ID,
      languages: ['es', 'hi'],
    })) as { structuredContent: LocalizationStart };

    expect(localize).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      { episodeId: EPISODE_ID, languages: ['es', 'hi'], requestedBy: 'test' },
    );
    expect(result.structuredContent).toEqual(start);
  });

  it('maps the start’s refusals to the contract', async () => {
    const inProgress = Object.assign(new Error('Already localizing into hi.'), {
      name: 'LocalizationInProgress',
    });
    const voices = Object.assign(
      new Error('Missing voice assignments for 1 character(s).'),
      { name: 'ActionRefusal' },
    );
    const tts = new Error('No TTS model configured for project.');

    for (const [thrown, code] of [
      [inProgress, 'RUN_IN_PROGRESS'],
      [voices, 'VALIDATION_FAILED'],
      [tts, 'VALIDATION_FAILED'],
    ] as const) {
      const { call } = setup({
        localize: async () => {
          throw thrown;
        },
      });

      const error = await refusal(
        call('localize_episode', { episodeId: EPISODE_ID, languages: ['hi'] }),
      );

      expect(error.code).toBe(code);
    }
  });

  it('refuses a reader who cannot write the project', async () => {
    const { call, localize } = setup({ canWrite: false });

    const error = await refusal(
      call('localize_episode', { episodeId: EPISODE_ID, languages: ['hi'] }),
    );

    expect(error.code).toBe('FORBIDDEN');
    expect(localize).not.toHaveBeenCalled();
  });
});
