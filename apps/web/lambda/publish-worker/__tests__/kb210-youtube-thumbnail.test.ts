import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';

/**
 * KB-210. A long video's thumbnail reaches YouTube through thumbnails.set
 * after the upload, and a thumbnail YouTube refuses (an unverified channel
 * may not set one) leaves the video up and says why. Through the real SDK;
 * a local server reads what it sent.
 */

const requests: string[] = [];
let refuseThumbnail = false;
let server: Server;
let origin: string;
let workdir: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    // happy-dom's fetch makes CORS checks: answer as a cross-origin API
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    request.on('data', () => undefined);
    request.on('end', () => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader('content-type', 'application/json');
      if (refuseThumbnail && request.url?.includes('/thumbnails/set')) {
        response.statusCode = 403;
        response.end(
          JSON.stringify({
            error: {
              code: 403,
              message: 'The authenticated user doesnt have permissions.',
            },
          }),
        );
        return;
      }
      response.end(JSON.stringify({ id: 'video-1' }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Files on disk: the handler streams a local path without fetching it
  workdir = mkdtempSync(join(tmpdir(), 'kb-210-'));
  writeFileSync(join(workdir, 'video.mp4'), 'not really a video');
  writeFileSync(join(workdir, 'thumb.png'), 'not really a png');
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(workdir, { recursive: true, force: true });
});

beforeEach(() => {
  requests.length = 0;
  refuseThumbnail = false;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('VENDOR_URL_YOUTUBE_DATA', origin);
  vi.stubEnv('HTTPS_PROXY', origin);
  vi.stubEnv('NO_PROXY', '127.0.0.1');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function upload() {
  const { uploadToYouTube } = await import('../handlers/youtube');
  return uploadToYouTube(
    'token',
    {
      type: 'publish',
      videoUrl: join(workdir, 'video.mp4'),
      thumbnailUrl: join(workdir, 'thumb.png'),
      title: 'The harbour at dusk',
      description: 'Episode 1',
      tags: [],
      metadata: { madeForKids: false, categoryId: '22' },
    } as unknown as PublishJobMessage,
    { youtube_made_for_kids: false, youtube_category_id: '22' },
  );
}

describe('a long video’s thumbnail on YouTube (KB-210)', () => {
  it('sets the thumbnail on the uploaded video', async () => {
    const result = await upload();

    expect(result).toEqual({
      contentId: 'video-1',
      url: 'https://www.youtube.com/watch?v=video-1',
    });
    expect(
      requests.some(
        (r) =>
          r.startsWith('POST /upload/youtube/v3/thumbnails/set') &&
          r.includes('videoId=video-1'),
      ),
    ).toBe(true);
  });

  it('keeps the video when YouTube refuses the thumbnail, and says why', async () => {
    refuseThumbnail = true;

    const result = await upload();

    expect(result.contentId).toBe('video-1');
    expect(result.thumbnailError).toMatch(/YouTube refused the thumbnail/);
  });
});
