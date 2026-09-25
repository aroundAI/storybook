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

beforeEach(() => {
  send.mockReset();
  vi.stubEnv('R2_ACCOUNT_ID', 'test');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test');
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket');
  vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.test');
});

describe('uploadToR2 writes only inside its authorised target', () => {
  it('puts a key in the target episode', async () => {
    const key = `episodes/${EPISODE}/dialogue/line_1.mp3`;

    const result = await uploadToR2('audio', key, BODY, 'audio/mpeg', {
      episodeId: EPISODE,
    });

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
    );

    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ['another episode', `episodes/${OTHER}/dialogue/line_1.mp3`],
    ['another project', `projects/${OTHER}/sfx/asset.mp3`],
    ['a key that names nothing', `dialogue/${EPISODE}/line_1.mp3`],
  ])('refuses %s, and R2 is never called', async (_label, key) => {
    await expect(
      uploadToR2('audio', key, BODY, 'audio/mpeg', {
        episodeId: EPISODE,
        projectId: PROJECT,
      }),
    ).rejects.toThrow('outside its authorised target');
    expect(send).not.toHaveBeenCalled();
  });
});
