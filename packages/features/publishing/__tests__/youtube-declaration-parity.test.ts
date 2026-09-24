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

import type { PublishJobMessage } from '../src/lib/job-types';
import type { YouTubeChannelDeclaration } from '../src/lib/youtube-declaration';

/**
 * KB-30, acceptance criterion 2: the lambda path sends the same declaration as
 * the in-app path.
 *
 * The two paths build YouTube's request differently — the lambda walks
 * `videos.insert` itself, the app goes through `YouTubeProvider` — so this
 * runs the real code of both against one local stand-in for YouTube and reads
 * what each actually sent. Nothing about the SDK is mocked.
 *
 * Before KB-30 both sent `selfDeclaredMadeForKids: false` and category `22`
 * for a publish nobody had declared, and ignored the channel's answer.
 */

interface Captured {
  path: string;
  resource: {
    snippet?: { categoryId?: string };
    status?: { madeForKids?: boolean; selfDeclaredMadeForKids?: boolean };
  } | null;
}

const captured: Captured[] = [];
let server: Server;
let origin: string;
let workdir: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.setEncoding('latin1');
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const json = body
        .split(/\r?\n/)
        .find((line) => line.includes('"snippet"'));
      captured.push({
        path: `${request.method} ${request.url?.split('?')[0]}`,
        resource: json ? JSON.parse(json) : null,
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: 'video-1' }));
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  workdir = mkdtempSync(join(tmpdir(), 'kb-30-'));
  writeFileSync(join(workdir, 'video.mp4'), 'not really a video');
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(workdir, { recursive: true, force: true });
});

afterEach(() => {
  captured.length = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function sandboxed() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('VENDOR_URL_YOUTUBE_DATA', origin);
  // Anything that escapes to the real host is refused offline.
  vi.stubEnv('HTTPS_PROXY', origin);
  vi.stubEnv('NO_PROXY', '127.0.0.1');
  vi.resetModules();

  const inApp = await import('../src/server/youtube-upload');
  const lambda = await import(
    '../../../../apps/web/lambda/publish-worker/handlers/youtube'
  );

  return { inApp: inApp.uploadToYouTube, lambda: lambda.uploadToYouTube };
}

type Sent = {
  madeForKids?: boolean;
  selfDeclared?: boolean;
  categoryId?: string;
};

function lastUpload(): Sent | 'no upload' {
  const upload = captured.find(
    (c) => c.path === 'POST /upload/youtube/v3/videos',
  );
  captured.length = 0;

  if (!upload) return 'no upload';

  return {
    madeForKids: upload.resource?.status?.madeForKids,
    selfDeclared: upload.resource?.status?.selfDeclaredMadeForKids,
    categoryId: upload.resource?.snippet?.categoryId,
  };
}

async function sendBoth(
  metadata: Record<string, unknown>,
  channel: YouTubeChannelDeclaration | null,
) {
  const { inApp, lambda } = await sandboxed();
  const videoUrl = join(workdir, 'video.mp4');

  const outcome = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return lastUpload();
    } catch (error) {
      const sent = lastUpload();
      return { threw: (error as Error).name, sent };
    }
  };

  const app = await outcome(() =>
    inApp(
      'token',
      {
        videoUrl,
        title: 'Episode',
        description: '',
        tags: [],
        privacy: 'public',
        platformSpecific: metadata,
      },
      channel,
    ),
  );

  const worker = await outcome(() =>
    lambda(
      'token',
      {
        videoUrl,
        title: 'Episode',
        description: '',
        tags: [],
        metadata,
      } as unknown as PublishJobMessage,
      channel,
    ),
  );

  return { app, worker };
}

describe('the in-app and lambda YouTube uploads declare the same thing', () => {
  const undeclared = { youtube_made_for_kids: null, youtube_category_id: null };

  it.each([
    {
      name: 'the publish carries "made for kids"',
      metadata: { madeForKids: true, categoryId: '1' },
      channel: undeclared,
      sent: { madeForKids: true, selfDeclared: true, categoryId: '1' },
    },
    {
      name: 'the publish carries "not made for kids" over a channel that says otherwise',
      metadata: { madeForKids: false, categoryId: '27' },
      channel: { youtube_made_for_kids: true, youtube_category_id: '1' },
      sent: { madeForKids: false, selfDeclared: false, categoryId: '27' },
    },
    {
      name: "a pre-KB-30 row with no snapshot takes the channel's answer",
      metadata: {},
      channel: { youtube_made_for_kids: true, youtube_category_id: '24' },
      sent: { madeForKids: true, selfDeclared: true, categoryId: '24' },
    },
  ])('$name', async ({ metadata, channel, sent }) => {
    const { app, worker } = await sendBoth(metadata, channel);

    expect(app).toEqual(sent);
    expect(worker).toEqual(app);
  });

  it('nobody declared anything: both refuse, and neither sends an upload', async () => {
    const { app, worker } = await sendBoth({}, undeclared);

    const refused = { threw: 'YouTubeDeclarationMissing', sent: 'no upload' };
    expect(app).toEqual(refused);
    expect(worker).toEqual(refused);
  });
});
