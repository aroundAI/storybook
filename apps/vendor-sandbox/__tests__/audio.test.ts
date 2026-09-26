import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  FRAME_SECONDS,
  mp3Duration,
  silentMp3,
  speechSeconds,
} from '../src/audio/mp3';
import { INVALID_KEY } from '../src/vendors/elevenlabs';
import { type Sandbox, guardEgress, startSandbox } from './helpers';

/**
 * FILM-1803 §3: audio responses are valid files of roughly the requested
 * duration. The app's own ElevenLabs providers are driven against the
 * stand-in, reaching it through VENDOR_URL_ELEVENLABS; durations are measured
 * from the MP3 frames, the way a player measures them.
 */

let sandbox: Sandbox;
let refused: string[];
let providers: typeof import('@kit/audio-generation/providers');

beforeAll(async () => {
  sandbox = await startSandbox(1113);
  refused = guardEgress();
  // The providers read their base URL when their module loads, so the
  // environment is set before they are imported.
  providers = await import('@kit/audio-generation/providers');
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await sandbox.close();
});

const within2Percent = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    Math.max(expected * 0.02, FRAME_SECONDS),
  );

describe('the MP3 itself', () => {
  it.each([0.6, 2.5, 30, 180])(
    '%s s is %s s long, frame for frame',
    (seconds) => {
      within2Percent(mp3Duration(silentMp3(seconds)), seconds);
    },
  );

  it('starts with an MPEG-1 Layer III frame header', () => {
    const header = silentMp3(1).subarray(0, 4);
    expect([...header]).toEqual([0xff, 0xfb, 0x90, 0xc4]);
  });
});

describe('ElevenLabs, through the app’s own providers', () => {
  const KEY = 'sandbox-local-key';
  /** As `server/voice-actions.ts` builds it. */
  const voiceProvider = () =>
    new providers.ElevenLabsProvider({
      apiKey: KEY,
      timeout: 60_000,
      maxRetries: 3,
    });

  async function firstVoice() {
    const voices = await voiceProvider().getVoices();
    return voices.voices[0]!;
  }

  it('lists voices with real names and labels', async () => {
    const { voices } = await voiceProvider().getVoices();
    expect(voices.length).toBeGreaterThanOrEqual(10);
    for (const voice of voices) {
      expect(voice.name).toMatch(/^[A-Z][a-z]+$/);
      expect(voice.gender).toMatch(/^(male|female)$/);
    }
  });

  it('speaks a line for about as long as it takes to say it', async () => {
    const text =
      'If we leave now, we can still catch the last ferry to Larkspur Island tonight.';
    const voice = await firstVoice();

    const result = await voiceProvider().generateVoice({
      text,
      voiceId: voice.id,
      modelId: 'eleven_multilingual_v2',
    });

    within2Percent(mp3Duration(result.audioBuffer!), speechSeconds(text));
    expect(
      sandbox.state.ledger.list({ vendor: 'elevenlabs' })[0],
    ).toMatchObject({
      path: `/v1/text-to-speech/${voice.id}`,
      status: 200,
    });
  });

  it('streams speech as MP3', async () => {
    const voice = await firstVoice();
    const stream = await voiceProvider().generateVoiceStream({
      text: 'Pancakes first. Mysteries after.',
      voiceId: voice.id,
      modelId: 'eleven_multilingual_v2',
    });

    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read())
      chunks.push(r.value);
    within2Percent(
      mp3Duration(Buffer.concat(chunks)),
      speechSeconds('Pancakes first. Mysteries after.'),
    );
  });

  it('refuses a voice that does not exist, as the vendor does', async () => {
    await expect(
      voiceProvider().generateVoice({
        text: 'Hello there.',
        voiceId: 'NoSuchVoice000000000',
        modelId: 'eleven_multilingual_v2',
      }),
    ).rejects.toThrow();
    expect(sandbox.state.ledger.list({ vendor: 'elevenlabs' })[0]?.status).toBe(
      404,
    );
  });

  it.each([2, 8, 22])('makes a %s s sound effect', async (seconds) => {
    const result = await new providers.ElevenLabsSfxProvider({
      apiKey: KEY,
    }).generateSfx({
      text: 'A ferry horn far across the water',
      durationSeconds: seconds,
    });

    expect(result.status, result.error).toBe('completed');
    within2Percent(mp3Duration(result.audioBuffer!), seconds);
  });

  it('serves music at the documented endpoint for the requested length', async () => {
    const response = await fetch(`${sandbox.urls.elevenlabs}/v1/music`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Warm acoustic theme for a seaside mystery',
        music_length_ms: 45_000,
      }),
    });

    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    within2Percent(
      mp3Duration(new Uint8Array(await response.arrayBuffer())),
      45,
    );
  });

  /**
   * The app's music provider calls `/v1/music/compose`, which ElevenLabs'
   * API reference does not list (its endpoint is `POST /v1/music`). The
   * stand-in serves only documented paths, so the app's music generation
   * fails here as it would against the real vendor. Recorded as a lead
   * (specs/known-bugs/leads/2026-09-25-ai-sandbox.md): it was read from the
   * vendor's reference, not reproduced against the vendor.
   */
  it('gives the app’s music provider the vendor’s 404 for its undocumented path', async () => {
    await expect(
      new providers.ElevenLabsMusicProvider({ apiKey: KEY }).generateMusic({
        prompt: 'Warm acoustic theme for a seaside mystery',
        duration: 30,
      }),
    ).rejects.toThrow(/404/);
    expect(
      sandbox.state.ledger.list({ vendor: 'elevenlabs' })[0],
    ).toMatchObject({
      path: '/v1/music/compose',
      status: 404,
    });
  });

  it('answers the account and model checks the settings page makes', async () => {
    const user = (await (
      await fetch(`${sandbox.urls.elevenlabs}/v1/user`, {
        headers: { 'xi-api-key': KEY },
      })
    ).json()) as {
      subscription: {
        tier: string;
        status: string;
        character_count: number;
        character_limit: number;
      };
    };
    expect(user.subscription.character_count).toBeLessThan(
      user.subscription.character_limit,
    );

    const models = (await (
      await fetch(`${sandbox.urls.elevenlabs}/v1/models`, {
        headers: { 'xi-api-key': KEY },
      })
    ).json()) as Array<{
      model_id: string;
      can_do_text_to_speech: boolean;
    }>;
    expect(models.some((m) => m.can_do_text_to_speech)).toBe(true);

    expect(
      (
        await fetch(`${sandbox.urls.elevenlabs}/v1/user`, {
          headers: { 'xi-api-key': INVALID_KEY },
        })
      ).status,
    ).toBe(401);
  });
});

describe('OpenAI', () => {
  it('answers the settings key check and nothing else', async () => {
    const ok = await fetch(`${sandbox.urls.openai}/v1/models`, {
      headers: { authorization: 'Bearer sandbox-local-key' },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { object: string }).object).toBe('list');

    expect(
      (
        await fetch(`${sandbox.urls.openai}/v1/models`, {
          headers: { authorization: `Bearer ${INVALID_KEY}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${sandbox.urls.openai}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: 'Bearer sandbox-local-key' },
        })
      ).status,
    ).toBe(404);
  });
});

describe('isolation', () => {
  it('let nothing leave the machine', () => {
    expect(refused).toEqual([]);
  });
});
