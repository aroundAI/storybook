import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * FILM-1801. `@googleapis/youtube` is not mocked here: what is under test is
 * whether the real SDK sends its requests where `vendorUrl('youtube-data')`
 * says, and a mock would only repeat what this file expects of it.
 *
 * The upload is its own case because the SDK treats it differently. A client's
 * `rootUrl` rewrites `options.url` but not `mediaUrl`, so `videos.insert` and
 * `thumbnails.set` kept going to the real host until `rootUrl` was also passed
 * per call.
 */

const requests: string[] = [];
let server: Server;
let origin: string;
let workdir: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url?.split('?')[0]}`);
    request.resume();
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: 'video-1', items: [] }));
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  workdir = mkdtempSync(join(tmpdir(), 'film-1801-'));
  writeFileSync(join(workdir, 'video.mp4'), 'not really a video');
  writeFileSync(join(workdir, 'thumb.jpg'), 'not really an image');
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(workdir, { recursive: true, force: true });
});

afterEach(() => {
  requests.length = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function sandboxedProvider() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('VENDOR_URL_YOUTUBE_DATA', origin);
  // A request that escapes to the real host is sent here as a CONNECT, which
  // this server refuses - so a regression fails offline instead of calling
  // Google with a test token.
  vi.stubEnv('HTTPS_PROXY', origin);
  vi.stubEnv('NO_PROXY', '127.0.0.1');
  vi.resetModules();

  const { YouTubeProvider } = await import(
    '../src/providers/youtube/youtube-provider'
  );

  return new YouTubeProvider('access-token');
}

describe('YouTubeProvider sends its requests to the resolved host', () => {
  it('for a plain Data API call', async () => {
    const provider = await sandboxedProvider();

    await provider.getCategories();

    expect(requests).toEqual(['GET /youtube/v3/videoCategories']);
  });

  it('for the video upload and the thumbnail upload, which use mediaUrl', async () => {
    const provider = await sandboxedProvider();

    await provider.uploadVideo({
      videoPath: join(workdir, 'video.mp4'),
      thumbnailPath: join(workdir, 'thumb.jpg'),
      title: 'Lighthouse keepers of the Hebrides',
      description: '',
      tags: [],
      categoryId: '22',
      privacy: 'private',
      madeForKids: false,
    });

    expect(requests).toEqual([
      'POST /upload/youtube/v3/videos',
      'POST /upload/youtube/v3/thumbnails/set',
    ]);
  });
});
