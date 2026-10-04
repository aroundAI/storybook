import { describe, expect, it, vi } from 'vitest';

import {
  DUB_WAIT_SECONDS,
  DubEpisodeMessageSchema,
  LocalizeLanguagesSchema,
  dubTtsModel,
  mp3Seconds,
  timingAdjustment,
} from '../src/lib/dub-episode';
import {
  LocalizationInProgress,
  type LocalizeDeps,
  startEpisodeLocalization,
} from '../src/server/localize-starts';

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => {
    throw new Error('the caller passes its client');
  },
}));

/**
 * FILM-2007, the start of localize_episode: the same checks as
 * start_voice_render (writable episode, a voice per speaker, a TTS model),
 * one translation run for every language still to translate, a dubbed
 * version per language, and a dub-episode job each, held back while its
 * language is translated. The database is a fake answering by table; the
 * translation run and the queue are spies.
 */
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const MAYA = '55555555-5555-4555-8555-555555555555';
const DEV = '66666666-6666-4666-8666-666666666666';
const RUN = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-10-04T20:00:00.000Z');

const line = (
  n: number,
  speaker: string | null,
  language = 'en',
  source?: string,
) => ({
  id: `aaaaaaaa-0000-4000-8000-${language}00000000${n}`.slice(0, 36),
  episode_id: EPISODE,
  character_asset_id: speaker,
  text: `Line ${n}`,
  audio_url: n === 1 ? 'https://audio.test/1.mp3' : null,
  status: 'completed',
  sequence_number: n,
  language,
  source_dialogue_id: source ?? null,
});

const ENGLISH = [line(1, MAYA), line(2, DEV), line(3, MAYA)];
// Spanish already translated, line by line
const SPANISH = ENGLISH.map((l, i) => ({
  ...line(i + 1, l.character_asset_id, 'es', l.id),
  id: `bbbbbbbb-0000-4000-8000-00000000000${i + 1}`,
}));

interface Call {
  table: string;
  op: string;
  payload: unknown;
  filters: Array<[string, unknown[]]>;
}

function fakeDb(
  options: {
    lines?: unknown[];
    voices?: Array<{ asset_id: string; elevenlabs_voice_id: string | null }>;
    canWrite?: boolean;
    ttsModel?: string | null;
    dubbed?: Array<{
      id: string;
      language: string;
      status: string;
      updated_at: string;
    }>;
  } = {},
) {
  const calls: Call[] = [];

  const answer = (call: Call): { data: unknown; error: null } => {
    switch (call.table) {
      case 'episodes':
        return {
          data: {
            id: EPISODE,
            project_id: PROJECT,
            project: { account_id: ACCOUNT },
          },
          error: null,
        };
      case 'dialogue_lines': {
        const range = call.filters.find(
          ([m]) => m === 'range',
        )?.[1] as number[];
        return {
          data: range && range[0]! > 0 ? [] : (options.lines ?? ENGLISH),
          error: null,
        };
      }
      case 'character_details':
        return {
          data: options.voices ?? [
            { asset_id: MAYA, elevenlabs_voice_id: 'voice-maya' },
            { asset_id: DEV, elevenlabs_voice_id: 'voice-dev' },
          ],
          error: null,
        };
      case 'projects':
        return {
          data:
            options.ttsModel === null
              ? { audio_settings: null }
              : {
                  audio_settings: {
                    elevenlabs: {
                      tts_model: options.ttsModel ?? 'eleven_multilingual_v2',
                    },
                  },
                },
          error: null,
        };
      case 'dubbed_versions':
        if (call.op === 'upsert') {
          return {
            data: (call.payload as Array<{ language: string }>).map(
              (row, i) => ({
                id: `cccccccc-0000-4000-8000-00000000000${i}`,
                language: row.language,
              }),
            ),
            error: null,
          };
        }
        return { data: options.dubbed ?? [], error: null };
      default:
        return { data: null, error: null };
    }
  };

  const from = (table: string) => {
    const call: Call = { table, op: 'select', payload: null, filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};

    for (const method of [
      'select',
      'eq',
      'in',
      'is',
      'order',
      'range',
      'neq',
    ]) {
      chain[method] = (...args: unknown[]) => {
        if (method !== 'select' || call.op === 'select')
          call.filters.push([method, args]);
        return chain;
      };
    }
    chain.upsert = (payload: unknown) => {
      call.op = 'upsert';
      call.payload = payload;
      return chain;
    };
    chain.single = () => chain;
    chain.maybeSingle = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve(answer(call)));

    return chain;
  };

  const client = {
    from,
    rpc: async () => ({ data: options.canWrite ?? true, error: null }),
  };

  return { client: client as never, calls };
}

function deps(): LocalizeDeps & {
  openTranslationRun: ReturnType<typeof vi.fn>;
  queueDubJobs: ReturnType<typeof vi.fn>;
} {
  return {
    openTranslationRun: vi.fn(async () => RUN),
    queueDubJobs: vi.fn(async () => undefined),
    now: () => NOW,
  };
}

describe('localize languages (FILM-2007)', () => {
  it('takes the primary subtags StoryBook can both translate and voice', () => {
    expect(LocalizeLanguagesSchema.parse(['hi', 'es', 'zh'])).toEqual([
      'hi',
      'es',
      'zh',
    ]);

    for (const bad of [['pt-BR'], ['en'], ['xx'], ['HI'], ['es', 'es'], []]) {
      expect(LocalizeLanguagesSchema.safeParse(bad).success).toBe(false);
    }

    // Bengali is translated but no multilingual TTS model speaks it
    expect(LocalizeLanguagesSchema.safeParse(['bn']).success).toBe(false);
  });

  it('voices a dub with a multilingual model, and sizes and fits it', () => {
    expect(dubTtsModel('eleven_turbo_v2')).toBe('eleven_multilingual_v2');
    expect(dubTtsModel('eleven_flash_v2_5')).toBe('eleven_flash_v2_5');
    expect(mp3Seconds(32_000)).toBe(2);
    expect(timingAdjustment(3, 2)).toBe(1.5);
    expect(timingAdjustment(10, 2)).toBe(2);
    expect(timingAdjustment(0.5, 2)).toBe(0.5);
    expect(timingAdjustment(null, 2)).toBe(1);
  });
});

describe('startEpisodeLocalization (FILM-2007)', () => {
  it('opens one translation run for the untranslated languages and queues a dub per language', async () => {
    const db = fakeDb({ lines: [...ENGLISH, ...SPANISH] });
    const d = deps();

    const start = await startEpisodeLocalization(
      db.client,
      USER,
      {
        episodeId: EPISODE,
        languages: ['hi', 'es', 'ja'],
        requestedBy: 'Claude',
      },
      d,
    );

    expect(d.openTranslationRun).toHaveBeenCalledTimes(1);
    expect(d.openTranslationRun.mock.calls[0]![3]).toEqual(['hi', 'ja']);
    expect(start.translationRunId).toBe(RUN);
    expect(start.jobs.map((j) => [j.language, j.status, j.lines])).toEqual([
      ['hi', 'translating', 3],
      ['es', 'voicing', 3],
      ['ja', 'translating', 3],
    ]);

    const upsert = db.calls.find((c) => c.op === 'upsert')!;
    expect(upsert.payload).toEqual([
      expect.objectContaining({
        language: 'hi',
        status: 'translating',
        translation_status: 'processing',
      }),
      expect.objectContaining({
        language: 'es',
        status: 'voicing',
        translation_status: 'completed',
      }),
      expect.objectContaining({ language: 'ja', status: 'translating' }),
    ]);

    const jobs = d.queueDubJobs.mock.calls[0]![1] as Array<{
      message: unknown;
      delaySeconds: number;
    }>;
    expect(jobs.map((j) => j.delaySeconds)).toEqual([
      DUB_WAIT_SECONDS,
      0,
      DUB_WAIT_SECONDS,
    ]);

    const hi = DubEpisodeMessageSchema.parse(jobs[0]!.message);
    expect(hi).toMatchObject({
      kind: 'dub-episode',
      language: 'hi',
      accountId: ACCOUNT,
      episodeId: EPISODE,
      translationRunId: RUN,
      ttsModel: 'eleven_multilingual_v2',
      voiceAssignments: {
        [MAYA]: { voiceId: 'voice-maya' },
        [DEV]: { voiceId: 'voice-dev' },
      },
      source: { kind: 'dialogue_lines', lines: 3, withAudio: 1 },
    });
    expect(
      DubEpisodeMessageSchema.parse(jobs[1]!.message).translationRunId,
    ).toBeNull();
  });

  it('opens no translation run when every language is translated', async () => {
    const d = deps();

    await startEpisodeLocalization(
      fakeDb({ lines: [...ENGLISH, ...SPANISH] }).client,
      USER,
      { episodeId: EPISODE, languages: ['es'] },
      d,
    );

    expect(d.openTranslationRun).not.toHaveBeenCalled();
    expect(d.queueDubJobs).toHaveBeenCalledTimes(1);
  });

  it('refuses as start_voice_render does, before anything is written or spent', async () => {
    const cases: Array<[Parameters<typeof fakeDb>[0], RegExp]> = [
      [{ canWrite: false }, /Episode not found/],
      [{ lines: [] }, /no English dialogue/],
      [
        { voices: [{ asset_id: MAYA, elevenlabs_voice_id: 'voice-maya' }] },
        /Missing voice assignments for 1 character/,
      ],
      [{ ttsModel: null }, /No TTS model configured/],
    ];

    for (const [options, message] of cases) {
      const db = fakeDb(options);
      const d = deps();

      await expect(
        startEpisodeLocalization(
          db.client,
          USER,
          { episodeId: EPISODE, languages: ['hi'] },
          d,
        ),
      ).rejects.toThrow(message);
      expect(d.openTranslationRun).not.toHaveBeenCalled();
      expect(d.queueDubJobs).not.toHaveBeenCalled();
      expect(db.calls.some((c) => c.op === 'upsert')).toBe(false);
    }
  });

  it('refuses a language already being dubbed, unless that dub has gone stale', async () => {
    const recent = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const stale = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();

    await expect(
      startEpisodeLocalization(
        fakeDb({
          dubbed: [
            { id: 'x', language: 'hi', status: 'voicing', updated_at: recent },
          ],
        }).client,
        USER,
        { episodeId: EPISODE, languages: ['hi'] },
        deps(),
      ),
    ).rejects.toBeInstanceOf(LocalizationInProgress);

    await expect(
      startEpisodeLocalization(
        fakeDb({
          dubbed: [
            { id: 'x', language: 'hi', status: 'voicing', updated_at: stale },
          ],
        }).client,
        USER,
        { episodeId: EPISODE, languages: ['hi'] },
        deps(),
      ),
    ).resolves.toMatchObject({
      jobs: [expect.objectContaining({ language: 'hi' })],
    });
  });
});
