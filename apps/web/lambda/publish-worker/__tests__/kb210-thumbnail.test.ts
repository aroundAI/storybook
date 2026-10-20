import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';

/**
 * KB-210. Every long video the owner scheduled over MCP went out with no
 * thumbnail: the rows stored none, and the job is built from the row. The
 * worker now gives a long video with none the episode's thumbnail in its
 * language (else the default), never a Short, and only one of the
 * episode's own uploads (KB-104). A thumbnail the platform did not take is
 * recorded on the published row.
 */

const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const SUPABASE = 'https://abcdefghijklmnop.supabase.co';
const own = (file: string) =>
  `${SUPABASE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/thumbnails/${file}`;
const THUMB_EN = own('en-1.png');
const THUMB_HI = own('hi-1.png');
const FOREIGN = `${SUPABASE}/storage/v1/object/public/project-assets/episodes/someone-else/thumbnails/en-1.png`;

const db = vi.hoisted(() => ({
  row: { content_type: 'full', language: 'en' } as {
    content_type: string;
    language: string;
  } | null,
  thumbnails: [] as Array<{
    language: string;
    thumbnail_url: string;
    is_default: boolean;
  }>,
  reads: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
}));

const sent = vi.hoisted(() => ({
  jobs: [] as PublishJobMessage[],
  thumbnailError: undefined as string | undefined,
}));

vi.mock('../job-guard', () => ({
  PublishJobRefused: class extends Error {},
  deleteJobTarget: vi.fn(),
  duplicateJobRefusal: vi.fn(async () => null),
  holdPausedJob: vi.fn(async () => false),
  publishJobConnection: vi.fn(async () => 'conn-fb'),
}));
vi.mock('../token', () => ({
  checkConnectionToken: vi.fn(async () => ({
    valid: true,
    accessToken: 'page-token',
    platformAccountId: '1093',
  })),
}));
vi.mock('../handlers/facebook', () => ({
  uploadToFacebook: vi.fn(async (_token: string, job: PublishJobMessage) => {
    sent.jobs.push(structuredClone(job));
    return {
      contentId: 'video-9',
      url: 'https://www.facebook.com/1093/videos/video-9',
      ...(sent.thumbnailError && { thumbnailError: sent.thumbnailError }),
    };
  }),
}));
vi.mock('@kit/publishing/lib/owned-episode-video', () => ({
  EPISODE_VIDEO_PUBLISH_REFUSAL: 'not the episode video',
  ownedEpisodeVideo: vi.fn(async (url: string) => url),
}));
vi.mock('@kit/publishing/lib/uploaded-file-duration', () => ({
  recordUploadedFileDuration: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      let updating: Record<string, unknown> | null = null;
      const answer = () => {
        if (updating) {
          db.updates.push(updating);
          return { data: null, error: null };
        }
        if (table === 'episode_thumbnails') {
          return { data: db.thumbnails, error: null };
        }
        return { data: null, error: null };
      };
      const builder = {
        select: () => {
          db.reads.push(table);
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        update(values: Record<string, unknown>) {
          updating = values;
          return builder;
        },
        single: async () => ({
          data: table === 'publishes' ? { metadata: { kept: true } } : null,
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === 'publishes'
              ? db.row
              : table === 'episodes'
                ? { project_id: 'p1' }
                : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => void) => resolve(answer()),
      };
      return builder;
    },
  }),
}));

function event(overrides: Partial<PublishJobMessage> = {}): SQSEvent {
  const job = {
    type: 'publish',
    publishId: 'publish-1',
    platform: 'facebook',
    platformConnectionId: 'conn-fb',
    userId: 'user-1',
    episodeId: EPISODE,
    videoUrl: `${SUPABASE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en.mp4`,
    title: 't',
    description: 'd',
    tags: [],
    metadata: {},
    ...overrides,
  };
  return {
    Records: [{ messageId: 'm-1', body: JSON.stringify(job) }],
  } as unknown as SQSEvent;
}

async function run(overrides: Partial<PublishJobMessage> = {}) {
  const { handler } = await import('../index');
  const result = await handler(event(overrides));
  expect(result.batchItemFailures).toEqual([]);
  return sent.jobs[0]!;
}

beforeEach(() => {
  db.row = { content_type: 'full', language: 'en' };
  db.thumbnails = [
    { language: 'hi', thumbnail_url: THUMB_HI, is_default: true },
    { language: 'en', thumbnail_url: THUMB_EN, is_default: false },
  ];
  db.reads = [];
  db.updates = [];
  sent.jobs = [];
  sent.thumbnailError = undefined;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('STORAGE_PROVIDER', '');
  vi.stubEnv('CONNECTIONS_TABLE_NAME', '');
  vi.stubEnv('WEBSOCKET_ENDPOINT', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('the publish worker gives a long video the episode thumbnail (KB-210)', () => {
  it('sends a long video with no thumbnail the episode’s in its language', async () => {
    const job = await run();

    expect(job.thumbnailUrl).toBe(THUMB_EN);
  });

  it('falls back to the default thumbnail when none is in the video’s language', async () => {
    db.row = { content_type: 'full', language: 'fr' };

    const job = await run();

    expect(job.thumbnailUrl).toBe(THUMB_HI);
  });

  it('keeps a thumbnail the job already carries', async () => {
    const job = await run({ thumbnailUrl: THUMB_HI });

    expect(job.thumbnailUrl).toBe(THUMB_HI);
    expect(db.reads).not.toContain('episode_thumbnails');
  });

  it('sends a Short none, and never looks one up', async () => {
    db.row = { content_type: 'short', language: 'en' };

    const job = await run();

    expect(job.thumbnailUrl).toBeUndefined();
    expect(db.reads).not.toContain('episode_thumbnails');
  });

  it('sends nothing that is not one of the episode’s own uploads (KB-104)', async () => {
    db.thumbnails = [
      { language: 'en', thumbnail_url: FOREIGN, is_default: true },
    ];

    const job = await run();

    expect(job.thumbnailUrl).toBeUndefined();
  });

  it('posts the video when the episode has no thumbnail at all', async () => {
    db.thumbnails = [];

    const job = await run();

    expect(job.thumbnailUrl).toBeUndefined();
    expect(db.updates).toContainEqual(
      expect.objectContaining({ status: 'published' }),
    );
  });

  it('records a thumbnail the platform did not take, and still publishes', async () => {
    sent.thumbnailError = 'The thumbnail could not be downloaded.';

    await run();

    expect(db.updates).toContainEqual(
      expect.objectContaining({ status: 'published' }),
    );
    expect(db.updates).toContainEqual({
      metadata: {
        kept: true,
        thumbnailError: 'The thumbnail could not be downloaded.',
      },
    });
  });
});
