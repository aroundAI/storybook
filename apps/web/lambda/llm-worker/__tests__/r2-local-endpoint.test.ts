import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1806: a laptop has no R2, so the voice and audio workers could not
 * store what they made. In the sandbox only, their S3 client points at local
 * Supabase Storage's S3 endpoint (`VENDOR_URL_R2`); in production and in any
 * Lambda the override is never read and R2 is reached as before.
 */

const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: vi.fn((config: Record<string, unknown>) => {
      created.push(config);
      return { send: vi.fn() };
    }),
  };
});

const EPISODE = '11111111-5700-4000-8000-000000000002';
const LOCAL = 'http://127.0.0.1:55321/storage/v1/s3';

async function uploadOnce() {
  vi.resetModules();
  const { uploadToR2 } = await import('../utils/r2-storage');
  await uploadToR2(
    'audio',
    `episodes/${EPISODE}/dialogue/line_1.mp3`,
    Buffer.from('audio'),
    'audio/mpeg',
    { episodeId: EPISODE },
    { rpc: async () => ({ error: null }) },
  );
  return created.at(-1)!;
}

beforeEach(() => {
  created.length = 0;
  vi.stubEnv('R2_ACCESS_KEY_ID', 'local-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'local-secret');
  vi.stubEnv('R2_BUCKET_NAME', 'r2-local');
  vi.stubEnv(
    'R2_PUBLIC_URL',
    'http://127.0.0.1:55321/storage/v1/object/public/r2-local',
  );
  vi.stubEnv('VENDOR_URL_R2', LOCAL);
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the workers’ R2 client (FILM-1806)', () => {
  it('uses local Supabase Storage in the sandbox, with no R2 account', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('R2_ACCOUNT_ID', '');

    const config = await uploadOnce();

    expect(config.endpoint).toBe(LOCAL);
    expect(config.forcePathStyle).toBe(true);
  });

  it('ignores the override in production and reaches R2', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('R2_ACCOUNT_ID', 'acct');

    const config = await uploadOnce();

    expect(config.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
    expect(config.forcePathStyle).toBeUndefined();
  });

  it('ignores the override in a Lambda, sandbox flag or not', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'voice-worker');
    vi.stubEnv('R2_ACCOUNT_ID', 'acct');

    const config = await uploadOnce();

    expect(config.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
  });
});
