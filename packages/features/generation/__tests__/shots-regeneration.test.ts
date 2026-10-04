import { describe, expect, it } from 'vitest';

import {
  SHOT_REGENERATION_MAX,
  ShotsTargetSchema,
  checkWithSchema,
  shotsStage,
} from '../src';
import type { CommitPlan } from '../src/commit-plan';
import type { RecordedCall } from '../src/testing';
import { recordingClient } from '../src/testing';
import { ctxFor, episodeFixture, shotsOutput } from '../src/testing/part-d';

/**
 * FILM-2007: the shots stage re-plans only the listed shots. Its parts are
 * those shots, each brief carries that shot and its scene, the check holds
 * a re-planned shot to the scene part's rules, and the commit rewrites the
 * shots in place (no delete, no insert, no audio pass) and touches the
 * episode so its version moves.
 */

const SHOT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHOT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHOT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function storedShot(id: string, sequence: number, scene: number) {
  return {
    id,
    scene_number: scene,
    shot_number: sequence,
    sequence_number: sequence,
    scene_description: `Shot ${sequence} as planned`,
    prompt: `old prompt ${sequence}`,
    duration_seconds: 6,
    camera_direction: 'static',
    transition_type: 'cut',
    first_frame_description: null,
    last_frame_description: null,
    generation_metadata: { regeneration: { reason: 'too dark' } },
  };
}

const SHOTS = [
  storedShot(SHOT_A, 1, 1),
  storedShot(SHOT_B, 2, 1),
  storedShot(SHOT_C, 3, 2),
];

function argsOf(call: RecordedCall, method: string) {
  return call.chain.find((step) => step.method === method)?.args;
}

/** Answers a shots read by its `.in(...)` filter, as PostgREST would. */
function regenerationClient() {
  return recordingClient((call) => {
    if (call.table === 'episodes') return { data: episodeFixture.episode };

    if (call.table !== 'shots') return undefined;

    const inArgs = argsOf(call, 'in');

    if (!inArgs) return { data: null };

    const [column, values] = inArgs as [string, unknown[]];

    return {
      data: SHOTS.filter((shot) =>
        values.includes(shot[column as 'id' | 'sequence_number']),
      ),
    };
  });
}

const target = (shotIds: string[]) =>
  ShotsTargetSchema.parse({
    ...episodeFixture.ids,
    shotDuration: episodeFixture.shotDuration,
    regenerate: { shotIds, reason: 'The car park reads as daytime' },
  });

const sceneShot = shotsOutput.scenes[0]!.shots[0]!;

describe('shots stage, regeneration (FILM-2007)', () => {
  it('caps a re-plan at 20 shots and refuses a shot listed twice', () => {
    const ids = Array.from(
      { length: SHOT_REGENERATION_MAX + 1 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );

    expect(SHOT_REGENERATION_MAX).toBe(20);
    expect(() => target(ids)).toThrow();
    expect(() => target(ids.slice(0, 20))).not.toThrow();
    expect(() => target([SHOT_A, SHOT_A])).toThrow(/twice/);
    expect(() =>
      ShotsTargetSchema.parse({
        ...episodeFixture.ids,
        regenerate: { shotIds: [SHOT_A], reason: '   ' },
      }),
    ).toThrow();
  });

  it('has one part per listed shot, in sequence order, and none for the others', async () => {
    const parts = await shotsStage.parts(
      ctxFor(regenerationClient().client),
      target([SHOT_C, SHOT_A]),
    );

    expect(parts.map((p) => [p.key, p.index, p.total])).toEqual([
      [`shot:${SHOT_A}`, 0, 2],
      [`shot:${SHOT_C}`, 1, 2],
    ]);
  });

  it('refuses a shot that is not the episode’s', async () => {
    await expect(
      shotsStage.parts(
        ctxFor(regenerationClient().client),
        target(['dddddddd-dddd-4ddd-8ddd-dddddddddddd']),
      ),
    ).rejects.toThrow(/not shots of this episode/);
  });

  it('briefs one shot: its scene only, its current plan and the reason, with a one-shot schema', async () => {
    const ctx = ctxFor(regenerationClient().client);
    const t = target([SHOT_C]);
    const [part] = await shotsStage.parts(ctx, t);
    const brief = await shotsStage.prepare(ctx, t, part!);

    expect(brief.instructions).toContain('RE-PLAN ONE SHOT');
    expect(brief.instructions).toContain('The car park reads as daytime');
    expect(brief.instructions).toContain('old prompt 3');
    expect(brief.example).toBeUndefined();
    expect(brief.context.scenes).toHaveLength(1);
    expect(brief.context.regeneration).toMatchObject({
      shotId: SHOT_C,
      reason: 'The car park reads as daytime',
      currentPlan: { prompt: 'old prompt 3' },
      shotBefore: 'Shot 2 as planned',
      shotAfter: null,
    });
    expect(brief.constraints).toMatchObject({
      kind: 'shot',
      shotId: SHOT_C,
      sceneNumber: 2,
      shotsPerPart: 1,
    });
    expect(brief.outputSchema).toMatchObject({
      properties: { kind: { const: 'shot' } },
    });
  });

  it('checks a re-planned shot by the scene rules, and that it is the part’s shot', async () => {
    const ctx = ctxFor(regenerationClient().client);
    const t = target([SHOT_A]);
    const [part] = await shotsStage.parts(ctx, t);
    const good = { ...sceneShot, kind: 'shot', shotId: SHOT_A };

    expect(checkWithSchema(shotsStage.outputSchema, good).ok).toBe(true);
    expect(await shotsStage.check(ctx, t, good as never, part!)).toEqual([]);

    const errors = await shotsStage.check(
      ctx,
      t,
      { ...good, shotId: SHOT_B, duration: 10 } as never,
      part!,
    );

    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['shotId', 'wrong_shot'],
      ['duration', 'duration_out_of_range'],
    ]);

    const scene = await shotsStage.check(
      ctx,
      t,
      { kind: 'scene', sceneNumber: 1, shots: [] } as never,
      part!,
    );

    expect(scene[0]).toMatchObject({ code: 'wrong_part' });
  });

  it('commits the shots in place and touches the episode, with no audio pass', async () => {
    const recording = regenerationClient();
    const plans: CommitPlan[] = [];
    const ctx = ctxFor(recording.client, {
      commits: async (plan) => {
        plans.push(plan);
        return { results: {}, skipped: [], revisionId: null, finalized: false };
      },
    });
    const t = target([SHOT_A]);

    const commit = await shotsStage.commit(
      ctx,
      {
        id: 'run-1',
        mode: 'external',
        origin: { kind: 'external', at: episodeFixture.now },
      },
      t,
      [{ ...sceneShot, kind: 'shot', shotId: SHOT_A } as never],
    );

    expect(commit.status).toBe('committed');
    expect(commit.data.regeneratedShotIds).toEqual([SHOT_A]);
    expect(commit.followOns).toBeUndefined();

    const ops = plans[0]!.ops as unknown as Array<Record<string, unknown>>;

    expect(ops.map((op) => [op.table, op.op])).toEqual([
      ['shots', 'update'],
      ['episodes', 'update'],
    ]);
    // Any update of the episode moves its version (its trigger), and so the
    // Studio's package etag
    expect(ops[1]).toMatchObject({
      values: { updated_at: expect.any(String) },
      requireRows: true,
    });
    expect(ops[0]).toMatchObject({
      merge: ['generation_metadata'],
      requireRows: true,
      values: {
        prompt: sceneShot.veoPrompt.fullPrompt,
        duration_seconds: 5,
        generation_metadata: { replannedByRunId: 'run-1' },
      },
    });
    // Status and media stay out of the plan: the allowlist forbids them
    expect(Object.keys(ops[0]!.values as object)).not.toEqual(
      expect.arrayContaining(['status']),
    );
    expect(ops[0]!.values).not.toHaveProperty('video_url');
    expect(ops[0]!.values).not.toHaveProperty('status');
    expect(ops[0]!.match).toEqual(
      expect.arrayContaining([{ column: 'id', op: 'eq', value: SHOT_A }]),
    );
  });
});
