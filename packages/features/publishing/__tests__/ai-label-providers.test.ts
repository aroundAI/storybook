import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { X_API_BASE, X_MEDIA_UPLOAD } from '@kit/shared/vendors';

/**
 * FILM-1731. Each provider sends the creator's AI declaration on its
 * platform's own field exactly when the publish declares it, and sends no
 * such field otherwise: not `false`, not an empty value. A label nobody
 * declared is as wrong as a missing one.
 */

const VIDEO_URL = 'https://cdn.example.com/episode.mp4';
const VIDEO_BYTES = 12;

interface Call {
  url: string;
  method: string;
  body: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bodyText(body: BodyInit | null | undefined) {
  return typeof body === 'string' ? body : '';
}

/** Records every vendor call; the video itself answers with 12 bytes. */
function stubFetch(answer: (url: string, method: string) => Response) {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';

      if (url === VIDEO_URL) {
        return method === 'HEAD'
          ? new Response(null, {
              headers: { 'content-length': String(VIDEO_BYTES) },
            })
          : new Response(new Uint8Array(VIDEO_BYTES));
      }

      calls.push({ url, method, body: bodyText(init?.body) });
      return answer(url, method);
    }),
  );

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const DECLARATIONS = [
  { declared: true, label: 'declared' },
  { declared: false, label: 'declared not AI' },
  { declared: undefined, label: 'not declared at all' },
] as const;

describe('Instagram: is_ai_generated on the container request', () => {
  async function containerQuery(aiGenerated: boolean | undefined) {
    const calls = stubFetch((url, method) => {
      if (method === 'POST' && url.includes('/ig-1/media?')) {
        return json({ id: 'container-1' });
      }
      if (url.includes('/container-1?')) {
        return json({ status_code: 'FINISHED' });
      }
      if (url.includes('/ig-1/media_publish')) return json({ id: 'media-1' });
      return json({ permalink: 'https://www.instagram.com/reel/abc/' });
    });

    const { InstagramProvider } = await import('../src/providers/instagram');
    await new InstagramProvider('token', 'ig-1').uploadReel({
      videoUrl: VIDEO_URL,
      caption: 'The harbour at dusk',
      shareToFeed: true,
      aiGenerated,
    });

    const container = calls.find(
      (call) => call.method === 'POST' && call.url.includes('/ig-1/media?'),
    );

    return new URL(container!.url).searchParams;
  }

  for (const { declared, label } of DECLARATIONS) {
    it(`${label}: ${declared ? 'sends is_ai_generated=true' : 'sends no is_ai_generated'}`, async () => {
      const params = await containerQuery(declared);

      if (declared) expect(params.get('is_ai_generated')).toBe('true');
      else expect(params.has('is_ai_generated')).toBe(false);
    });
  }
});

describe('TikTok: post_info.is_aigc on the direct-post init', () => {
  async function postInfo(isAigc: boolean | undefined) {
    const calls = stubFetch((url) => {
      if (url.endsWith('/post/publish/video/init/')) {
        return json({
          data: {
            publish_id: 'v_pub_file~1',
            upload_url: 'https://upload.example.com/video/?upload_id=1',
          },
          error: { code: 'ok' },
        });
      }
      return new Response(null, { status: 201 });
    });

    const { TikTokProvider } = await import('../src/providers/tiktok');
    await new TikTokProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      caption: 'The harbour at dusk',
      privacy: 'PUBLIC',
      disableDuet: false,
      disableStitch: false,
      disableComment: false,
      isAigc,
    });

    const init = calls.find((call) =>
      call.url.endsWith('/post/publish/video/init/'),
    );

    return (JSON.parse(init!.body) as { post_info: Record<string, unknown> })
      .post_info;
  }

  for (const { declared, label } of DECLARATIONS) {
    it(`${label}: ${declared ? 'sends is_aigc: true' : 'sends no is_aigc'}`, async () => {
      const info = await postInfo(declared);

      if (declared) expect(info.is_aigc).toBe(true);
      else expect(info).not.toHaveProperty('is_aigc');
    });
  }
});

describe('X: made_with_ai on POST /2/tweets', () => {
  const MEDIA_ID = '1880000000000000001';

  async function postBody(madeWithAi: boolean | undefined) {
    const calls = stubFetch((url) => {
      if (url === X_MEDIA_UPLOAD.initialize) return json({ data: { id: MEDIA_ID } });
      if (url === X_MEDIA_UPLOAD.status(MEDIA_ID)) {
        return json({
          data: { id: MEDIA_ID, processing_info: { state: 'succeeded' } },
        });
      }
      if (url === X_MEDIA_UPLOAD.finalize(MEDIA_ID)) {
        return json({ data: { id: MEDIA_ID } });
      }
      if (url === `${X_API_BASE}/tweets`) return json({ data: { id: '99' } });
      return json({ data: {} });
    });

    const { TwitterProvider } = await import('../src/providers/twitter');
    await new TwitterProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      text: 'The harbour at dusk',
      madeWithAi,
    });

    const post = calls.find((call) => call.url === `${X_API_BASE}/tweets`);

    return JSON.parse(post!.body) as Record<string, unknown>;
  }

  for (const { declared, label } of DECLARATIONS) {
    it(`${label}: ${declared ? 'sends made_with_ai: true' : 'sends no made_with_ai'}`, async () => {
      const body = await postBody(declared);

      if (declared) expect(body.made_with_ai).toBe(true);
      else expect(body).not.toHaveProperty('made_with_ai');
    });
  }
});

/**
 * YouTube goes through the real `@googleapis/youtube` SDK, as in
 * `youtube-root-url.test.ts`: what matters is the resource the SDK puts on
 * the wire, so a local server reads the upload's JSON part.
 */
describe('YouTube: status.containsSyntheticMedia on videos.insert', () => {
  const uploads: string[] = [];
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
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
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  async function insertedStatus(containsSyntheticMedia: boolean | undefined) {
    uploads.length = 0;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('VENDOR_URL_YOUTUBE_DATA', origin);
    vi.stubEnv('HTTPS_PROXY', origin);
    vi.stubEnv('NO_PROXY', '127.0.0.1');
    vi.resetModules();

    const video = `${origin}/video.mp4`;
    const { YouTubeProvider } = await import(
      '../src/providers/youtube/youtube-provider'
    );
    await new YouTubeProvider('access-token').uploadVideo({
      videoPath: video,
      title: 'The harbour at dusk',
      description: '',
      tags: [],
      categoryId: '22',
      privacy: 'public',
      madeForKids: false,
      containsSyntheticMedia,
    });

    const resource = /\{"snippet"[\s\S]*?\}\}/.exec(uploads[0] ?? '')?.[0];

    return (JSON.parse(resource!) as { status: Record<string, unknown> })
      .status;
  }

  for (const { declared, label } of DECLARATIONS) {
    it(`${label}: ${declared ? 'sends containsSyntheticMedia: true' : 'sends no containsSyntheticMedia'}`, async () => {
      const status = await insertedStatus(declared);

      if (declared) expect(status.containsSyntheticMedia).toBe(true);
      else expect(status).not.toHaveProperty('containsSyntheticMedia');
    });
  }
});
