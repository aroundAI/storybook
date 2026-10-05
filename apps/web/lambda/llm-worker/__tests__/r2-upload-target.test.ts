import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadToR2 } from '../utils/r2-storage';

/**
 * KB-57: the workers write R2 with the app's own credentials and no user
 * session, so `writeProjectObject` cannot ask the database for them. Their
 * producer authorised a target (KB-46, KB-47); the upload refuses any key
 * outside it before R2 is called. There is no local R2: the S3 client is
 * replaced.
 */

const send = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();

  return { ...actual, S3Client: vi.fn(() => ({ send })) };
});

const PROJECT = '11111111-5700-4000-8000-000000000001';
const EPISODE = '11111111-5700-4000-8000-000000000002';
const OTHER = '11111111-5700-4000-8000-000000000009';
const BODY = Buffer.from('audio');
const checksums = { rpc: vi.fn(async () => ({ error: null })) };

beforeEach(() => {
  send.mockReset();
  checksums.rpc.mockClear();
  vi.stubEnv('R2_ACCOUNT_ID', 'test');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test');
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket');
  vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.test');
});

describe('uploadToR2 writes only inside its authorised target', () => {
  it('puts a key in the target episode', async () => {
    const key = `episodes/${EPISODE}/dialogue/line_1.mp3`;

    const result = await uploadToR2(
      'audio',
      key,
      BODY,
      'audio/mpeg',
      { episodeId: EPISODE },
      checksums,
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'test-bucket',
      Key: `audio/${key}`,
    });
    expect(result.url).toBe(`https://cdn.test/audio/${key}`);
  });

  it('puts a key in the target project', async () => {
    await uploadToR2(
      'audio',
      `projects/${PROJECT}/sfx/asset.mp3`,
      BODY,
      'audio/mpeg',
      { projectId: PROJECT },
      checksums,
    );

    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ['another episode', `episodes/${OTHER}/dialogue/line_1.mp3`],
    ['another project', `projects/${OTHER}/sfx/asset.mp3`],
    ['a key that names nothing', `dialogue/${EPISODE}/line_1.mp3`],
  ])('refuses %s, and R2 is never called', async (_label, key) => {
    await expect(
      uploadToR2(
        'audio',
        key,
        BODY,
        'audio/mpeg',
        { episodeId: EPISODE, projectId: PROJECT },
        checksums,
      ),
    ).rejects.toThrow('outside its authorised target');
    expect(send).not.toHaveBeenCalled();
    expect(checksums.rpc).not.toHaveBeenCalled();
  });
});

describe('uploadToR2 records what it stored (KB-189)', () => {
  it('records the SHA-256 and size of the stored bytes under their key', async () => {
    const key = `episodes/${EPISODE}/dialogue/line_1.mp3`;

    await uploadToR2(
      'audio',
      key,
      BODY,
      'audio/mpeg',
      { episodeId: EPISODE },
      checksums,
    );

    expect(checksums.rpc).toHaveBeenCalledExactlyOnceWith(
      'record_media_checksum',
      {
        p_bucket: 'audio',
        p_key: key,
        // printf audio | shasum -a 256
        p_sha256:
          '6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b',
        p_bytes: 5,
      },
    );
    // Recorded after the object is stored, never for a failed put
    expect(send.mock.invocationCallOrder[0]!).toBeLessThan(
      checksums.rpc.mock.invocationCallOrder[0]!,
    );
  });

  it('records nothing when the put fails', async () => {
    send.mockRejectedValueOnce(new Error('R2 down'));

    await expect(
      uploadToR2(
        'audio',
        `episodes/${EPISODE}/dialogue/line_1.mp3`,
        BODY,
        'audio/mpeg',
        { episodeId: EPISODE },
        checksums,
      ),
    ).rejects.toThrow('R2 down');
    expect(checksums.rpc).not.toHaveBeenCalled();
  });
});
