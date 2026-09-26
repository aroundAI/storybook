import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DialogueLineRefused,
  processDialogueVoiceGeneration,
} from '../voice-generation';

/**
 * KB-118. The voice worker writes a dialogue line on the service-role key.
 * The producer authorises the job's episode (KB-46) and the worker asks
 * again for the project (KB-49), but the line itself was written by id
 * alone: a job naming an authorised episode and another project's line would
 * spend the key and overwrite that line's audio. The worker now requires
 * the line to be in the job's episode before it reads the key, and every
 * write to the line is scoped to that episode too.
 */

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const OTHER_EPISODE = '77777777-7777-4777-8777-777777777777';
const LINE = '99999999-9999-4999-8999-999999999999';

const state = vi.hoisted(() => ({
  lineEpisode: '' as string | null,
  reads: [] as string[],
  updates: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}));

vi.mock('../../llm-worker/utils/r2-storage', () => ({
  uploadToR2: async () => ({ url: 'https://audio.test/line.mp3' }),
}));

function supabase() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let updating = false;
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        update: () => {
          updating = true;
          return chain;
        },
        maybeSingle: async () => {
          state.reads.push(table);
          return {
            data:
              state.lineEpisode === null
                ? null
                : { episode_id: state.lineEpisode },
            error: null,
          };
        },
        single: async () => {
          state.reads.push(table);
          return { data: null, error: { message: 'no key in this test' } };
        },
        then: <R>(resolve: (value: { error: null }) => R) => {
          if (updating) state.updates.push({ table, filters: { ...filters } });
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  } as never;
}

const payload = {
  dialogueLineId: LINE,
  episodeId: EPISODE,
  accountId: ACCOUNT,
  text: 'Hello',
  voiceId: 'voice-1',
  ttsModel: 'eleven_multilingual_v2',
  voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
};

beforeEach(() => {
  state.lineEpisode = EPISODE;
  state.reads.length = 0;
  state.updates.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1]))),
  );
});

describe('a dialogue line of another episode (KB-118)', () => {
  it('is refused before the key is read or the line is written', async () => {
    state.lineEpisode = OTHER_EPISODE;

    await expect(
      processDialogueVoiceGeneration(payload, supabase()),
    ).rejects.toBeInstanceOf(DialogueLineRefused);

    expect(state.reads).toEqual(['dialogue_lines']);
    expect(state.updates).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is refused when the line does not exist', async () => {
    state.lineEpisode = null;

    await expect(
      processDialogueVoiceGeneration(payload, supabase()),
    ).rejects.toBeInstanceOf(DialogueLineRefused);
    expect(state.updates).toEqual([]);
  });
});

describe("a dialogue line of the job's episode", () => {
  it('is written only where it is in that episode', async () => {
    // The key lookup fails in this harness, so the handler reaches its
    // failure write: that write must be scoped to the episode too.
    await expect(
      processDialogueVoiceGeneration(payload, supabase()),
    ).rejects.toThrow();

    expect(state.updates).toEqual([
      {
        table: 'dialogue_lines',
        filters: { id: LINE, episode_id: EPISODE },
      },
    ]);
  });
});
