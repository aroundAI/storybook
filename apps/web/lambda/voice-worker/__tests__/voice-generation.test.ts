import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processDialogueVoiceGeneration } from '../voice-generation';

/**
 * The voice worker generates a queued line on the payload account's key.
 * KB-83 made it count the cost against the account's usage; the budget
 * machinery is now removed (owner, 2026-09-25), so the worker generates the
 * line and calls no database function for spend.
 *
 * The real handler runs, decrypting a key encrypted here the way the app
 * encrypts it. The vendor and R2 are stubbed.
 */

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const LINE = '99999999-9999-4999-8999-999999999999';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../../llm-worker/utils/r2-storage', () => ({
  uploadToR2: async () => ({ url: 'https://audio.test/line.mp3' }),
}));

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

function supabaseWith(encrypted: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: { encrypted_key: encrypted, is_active: true },
      error: null,
    }),
    update: () => chain,
    then: <R>(resolve: (value: { error: null }) => R) =>
      Promise.resolve({ error: null }).then(resolve),
  };

  return { from: () => chain, rpc } as never;
}

const payload = (text: string) => ({
  dialogueLineId: LINE,
  episodeId: EPISODE,
  accountId: ACCOUNT,
  text,
  voiceId: 'voice-1',
  ttsModel: 'eleven_multilingual_v2',
  voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ENCRYPTION_KEY;
});

describe('voice worker', () => {
  it('generates a line and calls no database function for spend', async () => {
    const supabase = supabaseWith(await encryptedKey('sk-test'));

    const result = await processDialogueVoiceGeneration(
      payload('x'.repeat(1000)),
      supabase,
    );

    expect(result.success).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws when the vendor refuses the line', async () => {
    const supabase = supabaseWith(await encryptedKey('sk-test'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('quota', { status: 429 })),
    );

    await expect(
      processDialogueVoiceGeneration(payload('Hello'), supabase),
    ).rejects.toThrow('429');
    expect(rpc).not.toHaveBeenCalled();
  });
});
