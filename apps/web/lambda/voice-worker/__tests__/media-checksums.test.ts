import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dubEpisodeDeps } from '../dub-runtime';
import { processDialogueVoiceGeneration } from '../voice-generation';

/**
 * KB-189: the voice worker records the SHA-256 of every file it stores, so
 * the edit package (FILM-2001) carries one for each dialogue line and each
 * dubbed line. The real worker code and the real `uploadToR2` run; only the
 * S3 client and the vendor are replaced, and the database is a recorder.
 */

const send = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();

  return { ...actual, S3Client: vi.fn(() => ({ send })) };
});

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const LINE = '99999999-9999-4999-8999-999999999999';
const VOICE_BYTES = new Uint8Array([7, 1, 8, 9, 2]);
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

async function encryptedKey(plain: string) {
  const raw = webcrypto.getRandomValues(new Uint8Array(32));
  process.env.ENCRYPTION_KEY = Buffer.from(raw).toString('base64');

  const key = await webcrypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const sealed = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plain),
  );

  return Buffer.concat([iv, Buffer.from(sealed)]).toString('base64');
}

function recordingClient(encrypted = '') {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const updates: Array<Record<string, unknown>> = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: { encrypted_key: encrypted, is_active: true },
      error: null,
    }),
    update: (row: Record<string, unknown>) => {
      updates.push(row);
      return chain;
    },
    maybeSingle: async () => ({ data: { episode_id: EPISODE }, error: null }),
    then: <R>(resolve: (value: { error: null }) => R) =>
      Promise.resolve({ error: null }).then(resolve),
  };

  return { client: { from: () => chain, rpc } as never, rpc, updates };
}

beforeEach(() => {
  send.mockReset();
  vi.stubEnv('R2_ACCOUNT_ID', 'test');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test');
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket');
  vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.test');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(VOICE_BYTES)),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.ENCRYPTION_KEY;
});

describe('the voice worker records what it stores (KB-189)', () => {
  it('a generated dialogue line: the SHA-256 of the bytes put at its audio_url', async () => {
    const { client, rpc, updates } = recordingClient(
      await encryptedKey('sk-test'),
    );

    await processDialogueVoiceGeneration(
      {
        dialogueLineId: LINE,
        episodeId: EPISODE,
        accountId: ACCOUNT,
        text: 'Hello there.',
        voiceId: 'voice-1',
        ttsModel: 'eleven_multilingual_v2',
        voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
      },
      client,
    );

    const put = send.mock.calls[0]![0].input as { Key: string; Body: Buffer };
    const key = put.Key.replace(/^audio\//, '');

    expect(sha256(put.Body)).toBe(sha256(VOICE_BYTES));
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_media_checksum', {
      p_bucket: 'audio',
      p_key: key,
      p_sha256: sha256(VOICE_BYTES),
      p_bytes: VOICE_BYTES.length,
    });
    expect(key).toMatch(new RegExp(`^episodes/${EPISODE}/dialogue/${LINE}_`));
    // The line names the file whose hash was recorded
    expect(updates.at(-1)!.audio_url).toBe(`https://cdn.test/audio/${key}`);
  });

  it('a dubbed line: the SHA-256 of the bytes its storeAudio put', async () => {
    const { client, rpc } = recordingClient();
    const path = `episodes/${EPISODE}/dubbed/hi/${LINE}_1.mp3`;

    const url = await dubEpisodeDeps(client).storeAudio(
      path,
      Buffer.from(VOICE_BYTES),
      EPISODE,
    );

    expect(url).toBe(`https://cdn.test/audio/${path}`);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_media_checksum', {
      p_bucket: 'audio',
      p_key: path,
      p_sha256: sha256(VOICE_BYTES),
      p_bytes: VOICE_BYTES.length,
    });
  });
});
