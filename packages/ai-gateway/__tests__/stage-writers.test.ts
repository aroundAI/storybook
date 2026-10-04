import { describe, expect, it, vi } from 'vitest';

import {
  type Brief,
  type Ctx,
  type StageKey,
  seasonOutlineStage,
} from '@kit/generation';
import { fakeRunHandle } from '@kit/generation/testing';

import {
  GatewayError,
  createServerWriter,
  currentRun,
  defineStageWriter,
  installStageWriters,
} from '../src';

/**
 * KB-184: an orchestrated stage's server mode is its installed stage writer,
 * reached through the server writer, opened once per run and run inside it.
 * Without one the server writer refuses before any model call; a stage that
 * is not orchestrated is the brief's prompt, as before.
 */

const brief = (stage: StageKey, index = 0, total = 1): Brief => ({
  stage,
  part: { key: `p${index}`, index, total, label: `p${index}` },
  prompt: { slug: 'season-outline', version: 1, variables: {} },
  instructions: 'write',
  context: {},
  outputSchema: { type: 'object' },
  constraints: {},
  targetVersion: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

const scope = (run: ReturnType<typeof fakeRunHandle>['run']) => ({
  ctx: run.ctx as Ctx,
  target: { projectId: run.projectId },
});

describe('the server writer and stage writers', () => {
  it('refuses an orchestrated stage with no stage writer, before the executor', async () => {
    const execute = vi.fn();
    const { run } = fakeRunHandle({ stage: 'season_outline' });

    await expect(
      createServerWriter({ execute })(run, brief('season_outline'), scope(run)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GatewayError &&
        error.code === 'STAGE_WRITER_MISSING' &&
        error.runId === run.id,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('writes a stage that is not orchestrated through the brief’s prompt', async () => {
    const prompt = vi.fn(async () => ({ output: { story: {} } }));
    const { run } = fakeRunHandle({ stage: 'story_refinement' });

    await createServerWriter({ prompt })(
      run,
      brief('story_refinement'),
      scope(run),
    );

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('opens the installed writer once per run, with the scope, and runs every part inside the run', async () => {
    const open = vi.fn();
    const runsInScope: unknown[] = [];
    installStageWriters([
      defineStageWriter(seasonOutlineStage, (run, { target }) => {
        open(run.id, target.projectId);
        return async (b) => {
          runsInScope.push(currentRun());
          return { output: { part: b.part.index } };
        };
      }),
    ]);
    const prompt = vi.fn();
    const writer = createServerWriter({ prompt });
    const { run } = fakeRunHandle({ stage: 'season_outline' });

    const first = await writer(run, brief('season_outline', 0, 2), scope(run));
    const second = await writer(run, brief('season_outline', 1, 2), scope(run));

    expect(first.output).toEqual({ part: 0 });
    expect(second.output).toEqual({ part: 1 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(run.id, run.projectId);
    expect(runsInScope).toEqual([run, run]);
    expect(prompt).not.toHaveBeenCalled();

    // Another run opens its own
    const other = fakeRunHandle({ stage: 'season_outline' }).run;
    await writer(other, brief('season_outline'), scope(other));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('refuses an orchestrated stage written without runStage’s scope', async () => {
    const { run } = fakeRunHandle({ stage: 'season_outline' });

    await expect(
      createServerWriter()(run, brief('season_outline')),
    ).rejects.toMatchObject({ code: 'STAGE_WRITER_MISSING' });
  });
});
