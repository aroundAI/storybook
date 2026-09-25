import type http from 'node:http';

import { mp3Duration, silentMp3, speechSeconds } from '../audio/mp3';
import { corpus } from '../corpus';
import { type Handler, parseJson, sendJson } from '../http';
import { summarise } from '../ledger';
import { createRng } from '../rng';
import type { SandboxState } from '../state';

/**
 * ElevenLabs, as its public API reference documents it
 * (elevenlabs.io/docs/api-reference), for the endpoints the app calls:
 * text to speech (plain and streamed), voices, the user's subscription,
 * models, music and sound effects. Audio is a valid MP3 of the length the
 * request implies. Only documented paths are served: the app's music
 * provider calls `/v1/music/compose`, which the reference does not list
 * (its music endpoint is `/v1/music`), so that path gets the vendor's 404.
 */

export const VENDOR = 'elevenlabs';

/** The key a test sends to see the vendor's rejection. */
export const INVALID_KEY = 'sandbox-invalid-key';

const MUSIC_MS = { min: 3_000, max: 600_000 };
const SFX_SECONDS = { min: 0.5, max: 30, default: 5 };

const ACCENTS = [
  'american',
  'british',
  'australian',
  'irish',
  'indian',
  'nigerian',
];
const USE_CASES = ['narration', 'characters', 'conversational', 'news'];

/** A stable set of voices per run, named from the corpus. */
function voicesFor(seed: number) {
  const rng = createRng(seed ^ 0x5eed_7015);
  return rng
    .shuffle(corpus.firstNames)
    .slice(0, 12)
    .map((name, i) => ({
      voice_id: Array.from(
        { length: 20 },
        () =>
          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[
            rng.int(0, 61)
          ],
      ).join(''),
      name,
      category: 'premade',
      description: `${rng.pick(['Warm', 'Bright', 'Calm', 'Gravelly', 'Soft-spoken', 'Energetic'])} voice for ${rng.pick(USE_CASES)}`,
      labels: {
        accent: rng.pick(ACCENTS),
        gender: i % 2 === 0 ? 'female' : 'male',
        age: rng.pick(['young', 'middle aged', 'old']),
        use_case: rng.pick(USE_CASES),
      },
      preview_url: '',
    }));
}

const MODELS = [
  {
    model_id: 'eleven_multilingual_v2',
    name: 'Eleven Multilingual v2',
    can_do_text_to_speech: true,
    can_use_style: true,
    can_use_speaker_boost: true,
  },
  {
    model_id: 'eleven_flash_v2_5',
    name: 'Eleven Flash v2.5',
    can_do_text_to_speech: true,
    can_use_style: false,
    can_use_speaker_boost: false,
  },
  {
    model_id: 'eleven_turbo_v2_5',
    name: 'Eleven Turbo v2.5',
    can_do_text_to_speech: true,
    can_use_style: false,
    can_use_speaker_boost: false,
  },
  {
    model_id: 'eleven_multilingual_sts_v2',
    name: 'Eleven Multilingual STS v2',
    can_do_text_to_speech: false,
    can_use_style: true,
    can_use_speaker_boost: true,
  },
];

function keyOf(req: http.IncomingMessage) {
  const header = req.headers['xi-api-key'];
  return (Array.isArray(header) ? header[0] : header) ?? '';
}

export function elevenLabsHandler(
  state: SandboxState,
  origin: () => string,
): Handler {
  return (req, res, body) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const key = keyOf(req);
    const started = Date.now();

    const record = (
      status: number,
      extra: {
        responseSummary?: string;
        bytes?: number;
        injectedFailure?: boolean;
        requestSummary?: string;
      } = {},
    ) =>
      state.ledger.record({
        vendor: VENDOR,
        method,
        path,
        keyPresent: Boolean(key),
        status,
        durationMs: Date.now() - started,
        ...extra,
      });

    const json = (status: number, value: unknown, injectedFailure = false) => {
      const sent = sendJson(res, status, value);
      record(status, { responseSummary: summarise(sent), injectedFailure });
    };

    const audio = (seconds: number, requestSummary: string) => {
      const mp3 = silentMp3(seconds);
      res.writeHead(200, {
        'content-type': 'audio/mpeg',
        'content-length': mp3.length,
      });
      res.end(mp3);
      record(200, {
        bytes: mp3.length,
        requestSummary,
        responseSummary: `audio/mpeg, ${mp3Duration(mp3).toFixed(2)} s`,
      });
    };

    if (!key || key === INVALID_KEY) {
      return json(401, {
        detail: { status: 'invalid_api_key', message: 'Invalid API key' },
      });
    }

    const injected = state.takeFailure(VENDOR, path);
    if (injected) {
      return json(
        injected.status,
        injected.status === 429
          ? {
              detail: {
                status: 'too_many_concurrent_requests',
                message: 'Too many concurrent requests',
              },
            }
          : {
              detail: {
                status: 'internal_error',
                message: 'An internal error occurred',
              },
            },
        true,
      );
    }

    const request = (parseJson(body) ?? {}) as Record<string, unknown>;
    const voices = voicesFor(state.seed);

    const tts = /^\/v1\/text-to-speech\/([^/]+)(\/stream)?$/.exec(path);
    if (method === 'POST' && tts) {
      if (!voices.some((v) => v.voice_id === tts[1])) {
        return json(404, {
          detail: {
            status: 'voice_not_found',
            message: `A voice with the voice_id ${tts[1]} was not found.`,
          },
        });
      }
      const text = typeof request.text === 'string' ? request.text : '';
      if (!text.trim()) {
        return json(422, {
          detail: [
            { loc: ['body', 'text'], msg: 'Field required', type: 'missing' },
          ],
        });
      }
      return audio(speechSeconds(text), summarise(text));
    }

    if (method === 'GET' && path === '/v1/voices') {
      return json(200, {
        voices: voices.map((v) => ({
          ...v,
          preview_url: `${origin()}/previews/${v.voice_id}.mp3`,
        })),
      });
    }

    if (method === 'GET' && /^\/previews\/[^/]+\.mp3$/.test(path)) {
      return audio(2, 'voice preview');
    }

    if (method === 'GET' && path === '/v1/user') {
      return json(200, {
        user_id: `sbx${state.seed.toString(36)}`,
        first_name: voices[0]!.name,
        xi_api_key_preview: `sk_${'*'.repeat(8)}${key.slice(-4)}`,
        subscription: {
          tier: 'creator',
          status: 'active',
          character_count: 12_480 + (state.seed % 9_000),
          character_limit: 121_000,
          can_extend_character_limit: true,
        },
      });
    }

    if (method === 'GET' && path === '/v1/models') {
      return json(200, MODELS);
    }

    if (method === 'POST' && path === '/v1/music') {
      const ms = request.music_length_ms;
      if (typeof ms === 'number' && (ms < MUSIC_MS.min || ms > MUSIC_MS.max)) {
        return json(422, {
          detail: [
            {
              loc: ['body', 'music_length_ms'],
              msg: `Input should be between ${MUSIC_MS.min} and ${MUSIC_MS.max}`,
              type: 'value_error',
            },
          ],
        });
      }
      return audio(
        (typeof ms === 'number' ? ms : 30_000) / 1000,
        summarise(String(request.prompt ?? '')),
      );
    }

    if (method === 'POST' && path === '/v1/sound-generation') {
      const seconds = request.duration_seconds;
      if (
        typeof seconds === 'number' &&
        (seconds < SFX_SECONDS.min || seconds > SFX_SECONDS.max)
      ) {
        return json(422, {
          detail: [
            {
              loc: ['body', 'duration_seconds'],
              msg: `Input should be between ${SFX_SECONDS.min} and ${SFX_SECONDS.max}`,
              type: 'value_error',
            },
          ],
        });
      }
      return audio(
        typeof seconds === 'number' ? seconds : SFX_SECONDS.default,
        summarise(String(request.text ?? '')),
      );
    }

    return json(404, { detail: 'Not Found' });
  };
}
