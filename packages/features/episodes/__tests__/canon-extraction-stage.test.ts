import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingClient, tableResponder } from '@kit/generation/testing';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import old from '../../generation/__tests__/fixtures/episode-summary-old.json';
import fixture from '../../generation/src/testing/fixtures/episode-summary-fixture.json';
import { extractCanonChangesAction } from '../src/server/canon-actions';

/**
 * FILM-1901: extractCanonChangesAction runs on the `episode_summary` stage.
 * For the fixture the old action was recorded with, the prompt gets the same
 * variables and the user gets the same extraction; the stage now refuses a
 * reply that does not fit the prompt's output schema, and the action's
 * fallback catches that as it caught any failure before.
 */

const USER = '44444444-4444-4444-8444-444444444444';
const calls = vi.hoisted(() => [] as Array<{ variables: unknown }>);
const replies = vi.hoisted(() => [] as unknown[]);

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: USER }),
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/**
 * The action opens an `episode_summary` run through the gateway (FILM-1902)
 * and the run writes the stage's brief: here a fake run whose writer answers
 * from `replies`, so the brief's variables are what reached the model.
 */
vi.mock('@kit/ai-gateway', async () => {
  const { fakeRunHandle } = await import('@kit/generation/testing');

  return {
    openRun: async (
      stage: 'episode_summary',
      target: {
        id: string;
        accountId: string;
        projectId: string | null;
        input: never;
      },
    ) =>
      fakeRunHandle({
        stage,
        targetId: target.id,
        accountId: target.accountId,
        projectId: target.projectId,
        input: target.input,
        backend: {
          write: async (_run, brief) => {
            calls.push({ variables: brief.prompt.variables });
            return {
              output: replies.shift(),
              usage: {
                latencyMs: 1,
                tokens: 1,
                provider: 'gemini',
                model: 'm',
              },
            };
          },
          dispatch: async () => undefined,
        },
      }).run,
  };
});

function clientWithFixtures() {
  const recording = recordingClient(
    tableResponder({
      narrative_threads: fixture.threads,
      assets: fixture.characters,
      projects: { account_id: fixture.accountId },
    }),
  );

  vi.mocked(getSupabaseServerClient).mockReturnValue({
    ...(recording.client as object),
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  } as never);

  return recording;
}

describe('extractCanonChangesAction on the episode_summary stage', () => {
  beforeEach(() => {
    calls.length = 0;
    replies.length = 0;
  });

  it('renders the same variables and returns the same extraction as before, writing nothing', async () => {
    const recording = clientWithFixtures();
    replies.push(fixture.modelOutput);

    const result = await extractCanonChangesAction(fixture.input);

    expect(calls[0]!.variables).toEqual(old.executeLLM.variables);
    expect(JSON.parse(JSON.stringify(result))).toEqual(old.result);
    expect(recording.writes()).toEqual([]);
  });

  it('falls back to the basic summary when the model’s reply does not fit the schema', async () => {
    clientWithFixtures();
    replies.push({ summary: 'no extraction object' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await extractCanonChangesAction(fixture.input);

    expect(result.immutableEvents).toEqual([]);
    expect(result.sentimentScore).toBe(0.5);
    expect(result.episodeSummary).toContain('Maya confronts Dev');
    expect(warn).toHaveBeenCalledWith(
      '[Canon Extraction] LLM extraction failed, falling back to basic:',
      expect.objectContaining({ name: 'StageOutputRejected' }),
    );

    warn.mockRestore();
  });
});
