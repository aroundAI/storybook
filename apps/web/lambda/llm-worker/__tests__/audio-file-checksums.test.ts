import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generatedAudioPath } from '@kit/storage/upload-paths';

import { processAudioFileGeneration } from '../handlers/audio-file-generation';

/**
 * KB-189: music, SFX and ambience generated for a cue are stored through the
 * handler's `uploadFn`, which records the bytes' SHA-256 so the edit package
 * (FILM-2001) carries one for each track. The core functions are replaced by
 * ones that store what a vendor returned through the `uploadFn` they are
 * handed, as the real ones do; the real `uploadToR2` runs on a fake S3.
 */

const send = vi.hoisted(() => vi.fn());
const AUDIO = vi.hoisted(() => new Uint8Array([3, 1, 4, 1, 5, 9, 2, 6]));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();

  return { ...actual, S3Client: vi.fn(() => ({ send })) };
});

vi.mock('@kit/audio-generation/server-core', () => {
  const store =
    (kind: 'music' | 'sfx') =>
    async (input: {
      projectId: string;
      uploadFn: (
        bucket: string,
        path: string,
        data: Buffer,
        contentType: string,
      ) => Promise<{ url: string }>;
    }) => {
      const assetId = '77777777-7777-4777-8777-777777777777';
      const { url } = await input.uploadFn(
        'audio',
        `projects/${input.projectId}/${kind}/${assetId}.mp3`,
        Buffer.from(AUDIO),
        'audio/mpeg',
      );

      return { assetId, status: 'completed', fileUrl: url };
    };

  return {
    generateMusicElevenLabsCore: store('music'),
    generateSfxCore: store('sfx'),
  };
});

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const CUE = '88888888-8888-4888-8888-888888888888';
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

function recordingClient(encrypted: string) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const chain = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    single: async () => ({
      data: { account_id: ACCOUNT, encrypted_key: encrypted, is_active: true },
      error: null,
    }),
    then: <R>(resolve: (value: { error: null }) => R) =>
      Promise.resolve({ error: null }).then(resolve),
  };

  return { client: { from: () => chain, rpc } as never, rpc };
}

beforeEach(() => {
  send.mockReset();
  vi.stubEnv('R2_ACCOUNT_ID', 'test');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test');
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket');
  vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.ENCRYPTION_KEY;
});

describe('audio cue generation records what it stores (KB-189)', () => {
  it.each([
    ['music', 'music'],
    ['sfx', 'sfx'],
    ['ambient', 'sfx'],
  ] as const)('a generated %s track', async (cueType, kind) => {
    const { client, rpc } = recordingClient(await encryptedKey('sk-test'));

    const result = await processAudioFileGeneration(
      {
        accountId: ACCOUNT,
        projectId: PROJECT,
        episodeId: EPISODE,
        cueId: CUE,
        cueType,
        prompt: 'rain on a tin roof',
        durationSeconds: 10,
        startOffsetSeconds: 0,
      },
      client,
    );

    const key = generatedAudioPath(
      PROJECT,
      kind,
      '77777777-7777-4777-8777-777777777777',
    );

    expect(result.success).toBe(true);
    expect(send.mock.calls[0]![0].input).toMatchObject({ Key: `audio/${key}` });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_media_checksum', {
      p_bucket: 'audio',
      p_key: key,
      p_sha256: sha256(AUDIO),
      p_bytes: AUDIO.length,
    });
  });
});
