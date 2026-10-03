import { describe, expect, it } from 'vitest';

import type { RunCtx } from '@kit/generation';
import {
  TEST_IDS,
  fakeRunRow,
  recordingClient,
  runStoreResponder,
  runStoreState,
  tableResponder,
} from '@kit/generation/testing';
import { chainedLlmJobTarget } from '@kit/prompt-engine/llm-job-target';

import {
  SERVER_GENERATION_OFF_REFUSAL,
  STAGE_IN_PROGRESS_REFUSAL,
  openRunForJob,
  runRefusalMessage,
} from '../src/jobs';

async function refusalOf(opening: Promise<unknown>) {
  const error = await opening.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'openRunForJob should have been refused').not.toBeNull();

  return runRefusalMessage(error);
}

/**
 * FILM-1910: a web Generate button opens its worker job's run in server
 * mode, whatever the team's default. A team with server generation off is
 * refused, and so is a stage another run holds, with words the page can
 * show (runRefusalMessage), instead of an external run that the job row
 * and dispatch() then refuse with a 500.
 */

function ctxWith(
  settings: Record<string, unknown>,
  holder?: ReturnType<typeof fakeRunRow>,
): RunCtx {
  const state = runStoreState(holder ? [holder] : []);
  state.settings.set(TEST_IDS.account, settings);
  if (holder) state.holder = holder;
  state.episodeVersions.set(TEST_IDS.episode, 4);

  const { client } = recordingClient(
    runStoreResponder(state, tableResponder({})),
  );

  return { client, accountId: TEST_IDS.account, userId: TEST_IDS.user };
}

const params = {
  jobType: 'story-refinement' as const,
  userId: TEST_IDS.user,
  target: chainedLlmJobTarget({
    accountId: TEST_IDS.account,
    projectId: TEST_IDS.project,
    episodeId: TEST_IDS.episode,
  }),
  payload: { feedback: 'Tighter' },
  name: 'test.generate',
};

describe('a web Generate opens a server run (FILM-1910)', () => {
  it('opens server mode even when the team default is external', async () => {
    const run = await openRunForJob(
      params,
      ctxWith({
        server_generation_enabled: true,
        external_generation_enabled: true,
        default_mode: 'external',
      }),
    );

    expect(run.mode).toBe('server');
  });

  it('refuses, in words the page shows, when the team turned server generation off', async () => {
    const opening = openRunForJob(
      params,
      ctxWith({
        server_generation_enabled: false,
        external_generation_enabled: true,
        default_mode: 'external',
      }),
    );

    expect(await refusalOf(opening)).toBe(SERVER_GENERATION_OFF_REFUSAL);
  });

  it('refuses when another run holds the stage', async () => {
    const holder = fakeRunRow({
      stage: 'story_refinement',
      mode: 'external',
      status: 'in_progress',
    });

    const opening = openRunForJob(
      params,
      ctxWith(
        {
          server_generation_enabled: true,
          external_generation_enabled: true,
          default_mode: 'server',
        },
        holder,
      ),
    );

    expect(await refusalOf(opening)).toBe(STAGE_IN_PROGRESS_REFUSAL);
  });

  it('words nothing else as a refusal', () => {
    expect(runRefusalMessage(new Error('boom'))).toBeNull();
  });

  it('keeps a mode the caller asks for', async () => {
    const ctx = ctxWith({
      server_generation_enabled: true,
      external_generation_enabled: true,
      default_mode: 'server',
    });

    const run = await openRunForJob(params, {
      ...ctx,
      runMode: () => 'external',
    });

    expect(run.mode).toBe('external');
  });
});
