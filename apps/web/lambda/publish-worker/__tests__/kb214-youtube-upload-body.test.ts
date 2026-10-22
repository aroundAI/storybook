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
 * KB-214. What the upload asks YouTube for, through the real SDK: a staged
 * post is private with `publishAt` at its slot; a breaking one is private
 * with no time, for StoryBook to make public once it is HD; any other goes
 * public as before. Also the status a moved time sends back, whole.
 */

const bodies: Array<{ url: string; body: string; method: string }> = [];
let server: Server;
let origin: string;
let workdir: string;
let listedStatus: Record<string, unknown> = {};

beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, PUT');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      bodies.push({ url: request.url ?? '', body, method: request.method! });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && request.url?.includes('/videos')) {
        response.end(
          JSON.stringify({ items: [{ id: 'video-1', status: listedStatus }] }),
        );
        return;
      }
      response.end(JSON.stringify({ id: 'video-1' }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  workdir = mkdtempSync(join(tmpdir(), 'kb-214-'));
  writeFileSync(join(workdir, 'video.mp4'), 'not really a video');
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(workdir, { recursive: true, force: true });
});

beforeEach(() => {
  bodies.length = 0;
  listedStatus = {};
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
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

async function upload(staged?: PublishJobMessage['staged']) {
  const { uploadToYouTube } = await import('../handlers/youtube');
  await uploadToYouTube(
    'token',
    {
      type: 'publish',
      videoUrl: join(workdir, 'video.mp4'),
      title: 'The harbour at dusk',
      description: 'Episode 1',
      tags: [],
      metadata: { madeForKids: false, categoryId: '22' },
      ...(staged && { staged }),
    } as unknown as PublishJobMessage,
    { youtube_made_for_kids: false, youtube_category_id: '22' },
  );

  const insert = bodies.find((b) =>
    b.url.startsWith('/upload/youtube/v3/videos'),
  );
  const json = insert!.body.match(/\{"snippet".*?\}\}/s)![0];
  return JSON.parse(json) as { status: Record<string, unknown> };
}

describe('the YouTube upload (KB-214)', () => {
  it('is private with YouTube’s publish time at the slot when staged', async () => {
    const resource = await upload({ publishAt: '2026-11-05T14:00:00.000Z' });

    expect(resource.status).toMatchObject({
      privacyStatus: 'private',
      publishAt: '2026-11-05T14:00:00.000Z',
    });
  });

  it('is private with no time for a breaking post', async () => {
    const resource = await upload({
      publishAt: '2026-11-05T14:00:00.000Z',
      goLiveWhenReady: true,
    });

    expect(resource.status.privacyStatus).toBe('private');
    expect(resource.status.publishAt).toBeUndefined();
  });

  it('is public, with no time, when not staged', async () => {
    const resource = await upload();

    expect(resource.status.privacyStatus).toBe('public');
    expect(resource.status.publishAt).toBeUndefined();
  });

  it('moves a publish time sending the audience and AI label back as they were', async () => {
    listedStatus = {
      privacyStatus: 'private',
      publishAt: '2026-11-05T14:00:00Z',
      madeForKids: false,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      embeddable: true,
      license: 'youtube',
      publicStatsViewable: true,
    };
    const { youtubeStagingApi } = await import('../handlers/youtube');

    expect(
      await youtubeStagingApi('token').updatePublishAt(
        'video-1',
        '2026-11-05T14:10:00.000Z',
      ),
    ).toBe('set');

    const update = bodies.find((b) => b.method === 'PUT');
    expect(update!.url).toContain('part=status');
    expect(JSON.parse(update!.body)).toEqual({
      id: 'video-1',
      status: {
        privacyStatus: 'private',
        publishAt: '2026-11-05T14:10:00.000Z',
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
        embeddable: true,
        license: 'youtube',
        publicStatsViewable: true,
      },
    });
  });

  it('never makes a public video private again', async () => {
    listedStatus = { privacyStatus: 'public' };
    const { youtubeStagingApi } = await import('../handlers/youtube');

    expect(
      await youtubeStagingApi('token').updatePublishAt(
        'video-1',
        '2026-11-05T14:10:00.000Z',
      ),
    ).toBe('public');
    expect(bodies.some((b) => b.method === 'PUT')).toBe(false);
  });

  it('makes a breaking post public, keeping its status', async () => {
    listedStatus = { privacyStatus: 'private', selfDeclaredMadeForKids: false };
    const { youtubeStagingApi } = await import('../handlers/youtube');

    expect(await youtubeStagingApi('token').makePublic('video-1')).toBe('set');
    expect(JSON.parse(bodies.find((b) => b.method === 'PUT')!.body)).toEqual({
      id: 'video-1',
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    });
  });
});
