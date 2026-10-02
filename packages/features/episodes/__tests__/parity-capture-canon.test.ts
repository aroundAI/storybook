import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { recordingClient, tableResponder } from '@kit/generation/testing';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import fixture from '../../generation/__tests__/fixtures/episode-summary-fixture.json';
import { extractCanonChangesAction } from '../src/server/canon-actions';

/**
 * FILM-1901 parity capture (part D): the OLD extractCanonChangesAction's
 * prompt variables and returned extraction for a fixture model output,
 * saved for the episode_summary stage's parity test. Deleted in the same
 * PR once the action runs on the stage.
 */

const calls = vi.hoisted(() => [] as unknown[]);

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: '44444444-4444-4444-8444-444444444444' }),
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: async (config: unknown) => {
    calls.push(config);
    return { data: fixture.modelOutput, metadata: {} };
  },
}));

describe('old extractCanonChangesAction, recorded for the parity test', () => {
  it('saves the prompt variables and the mapped extraction', async () => {
    const recording = recordingClient(
      tableResponder({
        narrative_threads: fixture.threads,
        assets: fixture.characters,
      }),
    );

    vi.mocked(getSupabaseServerClient).mockReturnValue({
      ...(recording.client as object),
      auth: {
        getUser: async () => ({
          data: { user: { id: '44444444-4444-4444-8444-444444444444' } },
        }),
      },
    } as never);

    const result = await extractCanonChangesAction(fixture.input);

    expect(result.immutableEvents).toHaveLength(2);
    expect(result.sentimentScore).toBe(1);

    writeFileSync(
      path.resolve(
        __dirname,
        '../../generation/__tests__/fixtures/episode-summary-old.json',
      ),
      JSON.stringify(
        {
          executeLLM: calls[0],
          result,
          writes: recording.writes(),
        },
        null,
        2,
      ) + '\n',
    );
  });
});
