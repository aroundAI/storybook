import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DUB_LINES_PER_MESSAGE,
  DUB_MAX_WAITS,
  DUB_WAIT_SECONDS,
  type DubEpisodeMessageInput,
} from '@kit/audio-generation/dub-episode';

import { type DubEpisodeDeps, processDubEpisode } from '../dub-episode';
import { tableStore } from './helpers/table-store';

/**
 * FILM-2007, the voice worker's dub-episode job: per-line TTS of one
 * language. It waits for its translation, voices each translated line with
 * its speaker's voice at the source line's start, fits it to the source
 * line's time, continues itself in chunks, and when done marks the version
 * ready and moves the episode's version. The database is an in-memory
 * stand-in; TTS, storage and the queue are spies (the sandbox test runs
 * the real TTS call).
 */
const EPISODE = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '44444444-4444-4444-8444-444444444444';
const VERSION = 'cccccccc-0000-4000-8000-000000000001';
const RUN = '77777777-7777-4777-8777-777777777777';
const MAYA = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-10-04T21:00:00.000Z');

const src = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

function world(
  options: { lines?: number; translated?: number; runStatus?: string } = {},
) {
  const count = options.lines ?? 3;
  const english = Array.from({ length: count }, (_, i) => ({
    id: src(i + 1),
    episode_id: EPISODE,
    language: 'en',
    character_asset_id: i === count - 1 && count > 2 ? null : MAYA,
    text: `Line ${i + 1}`,
    sequence_number: i + 1,
    timeline_start_seconds: i * 4,
    estimated_duration_seconds: 2,
    // the narrator line (no character) was voiced with a voice of its own
    generation_metadata: { voiceId: 'voice-narrator', durationSeconds: 2 },
    source_dialogue_id: null,
  }));
  const hindi = english
    .slice(0, options.translated ?? count)
    .map((line, i) => ({
      ...line,
      id: `bbbbbbbb-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      language: 'hi',
      text: `पंक्ति ${i + 1}`,
      source_dialogue_id: line.id,
    }));

  return tableStore({
    dubbed_versions: [
      {
        id: VERSION,
        episode_id: EPISODE,
        language: 'hi',
        status: 'translating',
        metadata: { localization: { lines: count } },
      },
    ],
    dialogue_lines: [...english, ...hindi],
    generation_runs: [{ id: RUN, status: options.runStatus ?? 'committed' }],
    dubbed_dialogue_lines: [],
    episodes: [{ id: EPISODE, version: 9, deleted_at: null }],
  });
}

const message = (
  over: Partial<DubEpisodeMessageInput> = {},
): DubEpisodeMessageInput => ({
  kind: 'dub-episode',
  dubbedVersionId: VERSION,
  episodeId: EPISODE,
  accountId: ACCOUNT,
  userId: USER,
  language: 'hi',
  ttsModel: 'eleven_multilingual_v2',
  voiceAssignments: { [MAYA]: { voiceId: 'voice-maya' } },
  translationRunId: RUN,
  source: { kind: 'dialogue_lines', lines: 3, withAudio: 3 },
  requestedAt: '2026-10-04T20:00:00.000Z',
  waits: 0,
  ...over,
});

function deps(): DubEpisodeDeps & {
  speak: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  requeue: ReturnType<typeof vi.fn>;
} {
  return {
    apiKey: async () => 'sk-test',
    // 48 000 bytes = 3 s at 128 kbit/s
    speak: vi.fn(async () => Buffer.alloc(48_000)),
    upload: vi.fn(async (path: string) => `https://r2.test/audio/${path}`),
    requeue: vi.fn(async () => undefined),
    now: () => NOW,
  };
}

describe('dub-episode (FILM-2007)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('voices every translated line at its source start, fitted, then readies the version and moves the episode version', async () => {
    const db = world();
    const d = deps();

    const outcome = await processDubEpisode(message(), db.client, d);

    expect(outcome).toEqual({
      status: 'ready',
      voiced: 3,
      failed: 0,
      costCents: 3 * Math.ceil('पंक्ति 1'.length * 0.03),
    });
    expect(
      d.speak.mock.calls.map(([r]) => [r.voiceId, r.text, r.modelId]),
    ).toEqual([
      ['voice-maya', 'पंक्ति 1', 'eleven_multilingual_v2'],
      ['voice-maya', 'पंक्ति 2', 'eleven_multilingual_v2'],
      ['voice-narrator', 'पंक्ति 3', 'eleven_multilingual_v2'],
    ]);
    expect(d.upload.mock.calls[0]![0]).toBe(
      `episodes/${EPISODE}/dubbed/hi/${src(1)}_${NOW.getTime()}.mp3`,
    );

    const lines = db.tables.dubbed_dialogue_lines!;
    expect(
      lines.map((l) => [
        l.original_dialogue_id,
        l.timeline_start_seconds,
        l.duration_seconds,
        l.timing_adjustment,
        l.status,
      ]),
    ).toEqual([
      [src(1), 0, 3, 1.5, 'voiced'],
      [src(2), 4, 3, 1.5, 'voiced'],
      [src(3), 8, 3, 1.5, 'voiced'],
    ]);

    expect(db.tables.dubbed_versions![0]).toMatchObject({
      status: 'ready',
      translation_status: 'completed',
      voice_status: 'completed',
      metadata: { localization: { lines: 3, voicedLines: 3, failedLines: 0 } },
    });
    expect(db.tables.episodes![0]!.version).toBe(10);
  });

  it('waits for an open translation run, and gives up after the last wait', async () => {
    const db = world({ translated: 0, runStatus: 'in_progress' });
    const d = deps();

    expect(await processDubEpisode(message(), db.client, d)).toEqual({
      status: 'waiting',
      waits: 1,
    });
    expect(d.requeue).toHaveBeenCalledWith(
      expect.objectContaining({ waits: 1 }),
      DUB_WAIT_SECONDS,
    );
    expect(d.speak).not.toHaveBeenCalled();
    expect(db.tables.episodes![0]!.version).toBe(9);

    const late = await processDubEpisode(
      message({ waits: DUB_MAX_WAITS }),
      db.client,
      d,
    );
    expect(late).toMatchObject({ status: 'failed' });
    expect(db.tables.dubbed_versions![0]).toMatchObject({
      status: 'failed',
      translation_status: 'failed',
    });
  });

  it('fails the version when the translation run ended without its language', async () => {
    const db = world({ translated: 0, runStatus: 'failed' });

    const outcome = await processDubEpisode(message(), db.client, deps());

    expect(outcome).toEqual({
      status: 'failed',
      reason: 'The translation run ended failed without a hi translation',
    });
    expect(db.tables.episodes![0]!.version).toBe(9);
  });

  it(`voices ${DUB_LINES_PER_MESSAGE} lines a message and continues; a redelivery pays for no line twice`, async () => {
    const db = world({ lines: DUB_LINES_PER_MESSAGE + 2 });
    const d = deps();

    expect(await processDubEpisode(message(), db.client, d)).toEqual({
      status: 'continued',
      voiced: DUB_LINES_PER_MESSAGE,
      remaining: 2,
    });
    expect(d.requeue).toHaveBeenCalledWith(
      expect.objectContaining({ waits: 0 }),
      0,
    );
    expect(db.tables.episodes![0]!.version).toBe(9);

    const second = await processDubEpisode(message(), db.client, d);
    expect(second).toMatchObject({
      status: 'ready',
      voiced: DUB_LINES_PER_MESSAGE + 2,
    });
    expect(d.speak).toHaveBeenCalledTimes(DUB_LINES_PER_MESSAGE + 2);

    // A message delivered again after the version is ready does nothing
    expect(await processDubEpisode(message(), db.client, d)).toEqual({
      status: 'skipped',
      reason: 'already ready',
    });
    expect(d.speak).toHaveBeenCalledTimes(DUB_LINES_PER_MESSAGE + 2);
  });

  it('records a line the vendor refuses as failed and goes on; a rate limit goes back to the queue', async () => {
    const db = world();
    const d = deps();
    d.speak.mockRejectedValueOnce(
      new Error('ElevenLabs TTS API error: 404 - voice_not_found'),
    );

    const outcome = await processDubEpisode(message(), db.client, d);

    expect(outcome).toMatchObject({ status: 'ready', voiced: 2, failed: 1 });
    expect(db.tables.dubbed_versions![0]).toMatchObject({
      voice_status: 'failed',
    });

    const limited = world();
    const l = deps();
    l.speak.mockRejectedValueOnce(
      new Error('ElevenLabs TTS API error: 429 - too_many_concurrent_requests'),
    );

    await expect(
      processDubEpisode(message(), limited.client, l),
    ).rejects.toThrow(/429/);
  });

  it("refuses a message whose dubbed version is not its episode's", async () => {
    const db = world();

    await expect(
      processDubEpisode(
        message({ episodeId: '99999999-9999-4999-8999-999999999999' }),
        db.client,
        deps(),
      ),
    ).rejects.toMatchObject({ name: 'DubEpisodeRefused' });
  });
});
