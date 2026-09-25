import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processDialogueVoiceGeneration } from '../voice-generation';

/**
 * KB-83: batch and queued single-line voice run in this worker, on the
 * service-role key, and never added their cost to the account's usage — so
 * most voice spend was invisible to the budget. The worker now records it on
 * the payload's account, which the enqueuing action authorised (KB-46/47).
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

describe('voice worker spend (KB-83)', () => {
  it("adds a generated line's cost to the payload account's usage", async () => {
    const supabase = supabaseWith(await encryptedKey('sk-test'));
    const text = 'x'.repeat(1000); // ~$0.30 per 1k characters

    const result = await processDialogueVoiceGeneration(
      payload(text),
      supabase,
    );

    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith('increment_account_usage', {
      p_account_id: ACCOUNT,
      p_amount_cents: 30,
    });
  });

  it('records nothing when the vendor refuses the line', async () => {
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

  it('a failed recording does not fail the line', async () => {
    const supabase = supabaseWith(await encryptedKey('sk-test'));
    rpc.mockResolvedValue({ data: null, error: { message: 'reset' } });

    const result = await processDialogueVoiceGeneration(
      payload('Hello'),
      supabase,
    );

    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
