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

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import { X_API_BASE, X_MEDIA_UPLOAD } from '@kit/shared/vendors';

/**
 * FILM-1731. A scheduled publish reaches the platform through this worker,
 * which builds three of its requests itself rather than through the
 * providers (Instagram goes through InstagramProvider). Each sends the
 * publish's AI declaration on its platform's field exactly when the job
 * says it was declared, and nothing otherwise — including a job queued
 * before the declaration existed, which has no `aiGenerated` at all.
 */

const VIDEO_URL = 'https://cdn.example.com/episode.mp4';

const DECLARATIONS = [
  { aiGenerated: true, label: 'declared' },
  { aiGenerated: false, label: 'declared not AI' },
  { aiGenerated: undefined, label: 'a job queued before the declaration' },
] as const;

function jobWith(aiGenerated: boolean | undefined) {
  return {
    type: 'publish',
    videoUrl: VIDEO_URL,
    title: 'The harbour at dusk',
    description: 'Episode 1',
    tags: [],
    metadata: { accountId: '1784', madeForKids: false, categoryId: '22' },
    ...(aiGenerated === undefined ? {} : { aiGenerated }),
  } as unknown as PublishJobMessage;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Every request but the video's; the video answers with 12 bytes. */
function stubFetch(answer: (url: string) => Response) {
  const sent: Array<{ url: string; body: string }> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === VIDEO_URL) return new Response(new Uint8Array(12));
      sent.push({
        url,
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return answer(url);
    }),
  );

  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('the worker sends the AI label on each platform it builds itself', () => {
  for (const { aiGenerated, label } of DECLARATIONS) {
    it(`X, ${label}: ${aiGenerated ? 'made_with_ai: true' : 'no made_with_ai'}`, async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const MEDIA_ID = '1880000000000000001';
      const sent = stubFetch((url) => {
        if (url === X_MEDIA_UPLOAD.initialize)
          return json({ data: { id: MEDIA_ID } });
        if (url === X_MEDIA_UPLOAD.finalize(MEDIA_ID)) {
          return json({
            data: { id: MEDIA_ID, processing_info: { state: 'succeeded' } },
          });
        }
        if (url === `${X_API_BASE}/tweets`) return json({ data: { id: '9' } });
        return json({ data: {} });
      });

      const { uploadToTwitter } = await import('../handlers/twitter');
      await uploadToTwitter('token', jobWith(aiGenerated), {
        accountName: 'acme',
        scopes: ['tweet.read', 'tweet.write', 'media.write', 'users.read'],
      });

      const post = JSON.parse(
        sent.find((call) => call.url === `${X_API_BASE}/tweets`)!.body,
      ) as Record<string, unknown>;

      if (aiGenerated) expect(post.made_with_ai).toBe(true);
      else expect(post).not.toHaveProperty('made_with_ai');
    });

    it(`TikTok, ${label}: ${aiGenerated ? 'post_info.is_aigc: true' : 'no is_aigc'}`, async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      // The init is refused after it is read: what was sent is the subject,
      // and the worker would otherwise poll for minutes.
      const sent = stubFetch(() => json({ error: { code: 'stop' } }, 400));

      const { uploadToTikTok } = await import('../handlers/tiktok');
      await expect(
        uploadToTikTok('token', jobWith(aiGenerated)),
      ).rejects.toThrow('TikTok upload init failed');

      const init = JSON.parse(
        sent.find((call) => call.url.endsWith('/post/publish/video/init/'))!
          .body,
      ) as { post_info: Record<string, unknown> };

      if (aiGenerated) expect(init.post_info.is_aigc).toBe(true);
      else expect(init.post_info).not.toHaveProperty('is_aigc');
    });

    it(`Instagram, ${label}: ${aiGenerated ? 'is_ai_generated=true' : 'no is_ai_generated'}`, async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const sent = stubFetch((url) => {
        if (url.includes('/1784/media?')) return json({ id: 'container-1' });
        if (url.includes('/container-1?')) {
          return json({ status_code: 'FINISHED' });
        }
        if (url.includes('/1784/media_publish')) return json({ id: 'media-1' });
        return json({ permalink: 'https://www.instagram.com/reel/abc/' });
      });

      const { uploadToInstagram } = await import('../handlers/instagram');
      await uploadToInstagram('token', jobWith(aiGenerated));

      const params = new URL(
        sent.find((call) => call.url.includes('/1784/media?'))!.url,
      ).searchParams;

      if (aiGenerated) expect(params.get('is_ai_generated')).toBe('true');
      else expect(params.has('is_ai_generated')).toBe(false);
    });
  }
});

/** YouTube goes through the real SDK; a local server reads what it sent. */
describe('the worker sends status.containsSyntheticMedia to YouTube', () => {
  const uploads: string[] = [];
  let server: Server;
  let origin: string;
  let workdir: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      // This suite runs under happy-dom, whose fetch the SDK uses: answer
      // its CORS checks as a cross-origin API would.
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('access-control-allow-headers', '*');
      response.setHeader('access-control-allow-methods', 'GET, POST');
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url?.startsWith('/upload/youtube/v3/videos')) {
          uploads.push(Buffer.concat(chunks).toString('latin1'));
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: 'video-1' }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // A file on disk: the worker streams a local path without fetching it
    workdir = mkdtempSync(join(tmpdir(), 'film-1731-'));
    writeFileSync(join(workdir, 'video.mp4'), 'not really a video');
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    rmSync(workdir, { recursive: true, force: true });
  });

  for (const { aiGenerated, label } of DECLARATIONS) {
    it(`${label}: ${aiGenerated ? 'containsSyntheticMedia: true' : 'no containsSyntheticMedia'}`, async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      uploads.length = 0;
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('VENDOR_SANDBOX', '1');
      vi.stubEnv('VENDOR_URL_YOUTUBE_DATA', origin);
      vi.stubEnv('HTTPS_PROXY', origin);
      vi.stubEnv('NO_PROXY', '127.0.0.1');
      vi.resetModules();

      const { uploadToYouTube } = await import('../handlers/youtube');
      await uploadToYouTube(
        'token',
        { ...jobWith(aiGenerated), videoUrl: join(workdir, 'video.mp4') },
        { youtube_made_for_kids: false, youtube_category_id: '22' },
      );

      const resource = /\{"snippet"[\s\S]*?\}\}/.exec(uploads[0] ?? '')?.[0];
      const status = (
        JSON.parse(resource!) as { status: Record<string, unknown> }
      ).status;

      if (aiGenerated) expect(status.containsSyntheticMedia).toBe(true);
      else expect(status).not.toHaveProperty('containsSyntheticMedia');
    });
  }
});
