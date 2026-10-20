import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';

/**
 * KB-213. On 19 Oct 2026 "Publish All" ran twice and the same Short went to
 * one Facebook Page twice; on 20 Oct Meta refused the next post with code
 * 368 ("Confirm your identity before you can publish as this Page") and
 * every later post would have been sent into the block. The worker, the
 * one path to a platform (KB-206), now refuses a second post of a video
 * the account already has, and a code 368 pauses that connection only.
 *
 * The real job guard runs against an in-memory database; only the
 * platforms, the token and the file checks are stood in for.
 */

const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const SUPABASE = 'https://abcdefghijklmnop.supabase.co';
const VIDEO = `${SUPABASE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en.mp4`;
const FIRST_REEL = 'https://www.facebook.com/reel/1686907816188751';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  tables: new Map<string, Map<string, Record<string, unknown>>>(),
}));

const platform = vi.hoisted(() => ({
  uploads: [] as string[],
  failWith: null as Error | null,
}));

function table(name: string) {
  let rows = db.tables.get(name);
  if (!rows) {
    rows = new Map();
    db.tables.set(name, rows);
  }
  return rows as Map<string, Row>;
}

function from(name: string) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  let values: Record<string, unknown> | null = null;

  const matching = () =>
    [...table(name).values()].filter(
      (row) =>
        eqs.every(([column, value]) => row[column] === value) &&
        ins.every(([column, list]) => list.includes(row[column])),
    );

  const run = () => {
    const hit = matching();
    if (values) for (const row of hit) Object.assign(row, values);
    return { data: hit.map((row) => ({ ...row })), error: null };
  };

  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      eqs.push([column, value]);
      return q;
    },
    in: (column: string, list: unknown[]) => {
      ins.push([column, list]);
      return q;
    },
    update: (next: Record<string, unknown>) => {
      values = next;
      return q;
    },
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    single: async () => ({ data: run().data[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve(run()),
  };

  return q;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from }),
}));
vi.mock('../token', () => ({
  checkConnectionToken: vi.fn(async () => ({
    valid: true,
    accessToken: 'page-token',
    platformAccountId: '1093',
  })),
}));
vi.mock('../job-thumbnail', () => ({
  missingLongVideoThumbnail: vi.fn(async () => null),
}));
vi.mock('../handlers/facebook', () => ({
  uploadToFacebook: vi.fn(async (_token: string, job: PublishJobMessage) => {
    if (platform.failWith) throw platform.failWith;
    platform.uploads.push(job.publishId);
    return {
      contentId: `video-${job.publishId}`,
      url: `https://www.facebook.com/reel/${job.publishId}`,
    };
  }),
}));
vi.mock('../handlers/instagram', () => ({
  uploadToInstagram: vi.fn(async (_token: string, job: PublishJobMessage) => {
    platform.uploads.push(job.publishId);
    return {
      contentId: `media-${job.publishId}`,
      url: `https://www.instagram.com/reel/${job.publishId}`,
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

/** A Fault & Frontier Short, as a publish row of the incident */
function short(
  id: string,
  overrides: Partial<Row> & { connection?: string } = {},
): Row {
  const { connection = 'conn-fb', ...rest } = overrides;
  const connectionRow = table('platform_connections').get(connection);

  return {
    id,
    status: 'queued',
    episode_id: EPISODE,
    platform_connection_id: connection,
    platform: (connectionRow?.platform as string) ?? 'facebook',
    platform_content_id: null,
    platform_url: null,
    published_at: null,
    created_at: '2026-10-19T21:04:00Z',
    content_type: 'short',
    title: 'Would you send her through?',
    language: 'en',
    scheduled_at: null,
    metadata: { shortsGroupId: 'group-7' },
    episode: {
      project_id: 'p1',
      deleted_at: null,
      project: { account_id: 'a1' },
    },
    connection: { account_id: 'a1' },
    ...rest,
  };
}

function job(row: Row): PublishJobMessage {
  return {
    type: 'publish',
    publishId: row.id,
    platform: row.platform as PublishJobMessage['platform'],
    platformConnectionId: row.platform_connection_id as string,
    userId: 'user-1',
    episodeId: EPISODE,
    videoUrl: VIDEO,
    title: row.title as string,
    description: '',
    tags: [],
    metadata: row.metadata as Record<string, unknown>,
  };
}

async function deliver(...rows: Row[]) {
  for (const row of rows) table('publishes').set(row.id, row);

  const { handler } = await import('../index');
  return handler({
    Records: rows.map((row) => ({
      messageId: `m-${row.id}`,
      body: JSON.stringify(job(row)),
    })),
  } as unknown as SQSEvent);
}

const publish = (id: string) => table('publishes').get(id)!;
const failure = (id: string) =>
  (publish(id).metadata as { error?: string }).error;

beforeEach(() => {
  db.tables.clear();
  table('platform_connections').set('conn-fb', {
    id: 'conn-fb',
    platform: 'facebook',
    metadata: {},
  });
  table('platform_connections').set('conn-fb-2', {
    id: 'conn-fb-2',
    platform: 'facebook',
    metadata: {},
  });
  table('platform_connections').set('conn-ig', {
    id: 'conn-ig',
    platform: 'instagram',
    metadata: {},
  });
  table('episodes').set(EPISODE, { id: EPISODE, project_id: 'p1' });
  platform.uploads = [];
  platform.failWith = null;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('CONNECTIONS_TABLE_NAME', '');
  vi.stubEnv('WEBSOCKET_ENDPOINT', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('a video the account already has is not posted again (KB-213)', () => {
  const posted = () =>
    short('first', {
      status: 'published',
      platform_url: FIRST_REEL,
      published_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

  it('refuses the same Short on the same Page, saying where it already is', async () => {
    table('publishes').set('first', posted());

    const result = await deliver(short('second'));

    expect(platform.uploads).toEqual([]);
    expect(publish('second').status).toBe('failed');
    const date = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 10);
    expect(failure('second')).toMatch(
      `Already posted to this account as ${FIRST_REEL} on ${date}; not posted again`,
    );
    expect(failure('second')!.startsWith('Already posted')).toBe(true);
    // A refusal is an answer, not retried
    expect(result.batchItemFailures).toEqual([]);
  });

  it('refuses it under another title when it is the same Shorts group', async () => {
    table('publishes').set('first', posted());

    await deliver(short('second', { title: 'Another caption' }));

    expect(platform.uploads).toEqual([]);
  });

  it('refuses a second long video of the episode on the same Page', async () => {
    table('publishes').set(
      'first',
      short('first', {
        content_type: 'full',
        title: 'Fault & Frontier, episode 1',
        status: 'published',
        platform_url: FIRST_REEL,
        published_at: new Date().toISOString(),
        metadata: {},
      }),
    );

    await deliver(
      short('second', {
        content_type: 'full',
        title: 'FF-001',
        metadata: {},
      }),
    );

    expect(platform.uploads).toEqual([]);
  });

  it('posts the same Short to a different Page', async () => {
    table('publishes').set('first', posted());

    await deliver(short('other-page', { connection: 'conn-fb-2' }));

    expect(platform.uploads).toEqual(['other-page']);
    expect(publish('other-page').status).toBe('published');
  });

  it('posts it again once the earlier post is marked removed', async () => {
    table('publishes').set('first', { ...posted(), status: 'deleted' });

    await deliver(short('second'));

    expect(platform.uploads).toEqual(['second']);
  });

  it('sends one of two copies that arrive in the same batch', async () => {
    const result = await deliver(short('copy-a'), short('copy-b'));

    expect(platform.uploads).toHaveLength(1);
    expect([publish('copy-a').status, publish('copy-b').status].sort()).toEqual(
      ['failed', 'published'],
    );
    expect(result.batchItemFailures).toEqual([]);
  });
});

describe('Meta code 368 pauses that connection only (KB-213)', () => {
  const IDENTITY = new Error(
    'Facebook upload failed: 400 Bad Request - {"error":{"message":"Confirm your identity before you can publish as this Page.","type":"OAuthException","code":368,"error_subcode":4854002,"fbtrace_id":"A1"}}',
  );

  it('records the block on the connection and fails the post in plain words', async () => {
    platform.failWith = IDENTITY;

    const result = await deliver(short('blocked'));

    expect(result.batchItemFailures).toEqual([]);
    expect(
      (
        table('platform_connections').get('conn-fb')!.metadata as Record<
          string,
          unknown
        >
      ).publishBlock,
    ).toMatchObject({
      platform: 'facebook',
      code: 368,
      subcode: 4854002,
      message: 'Confirm your identity before you can publish as this Page.',
      at: expect.any(String),
    });
    expect(publish('blocked').status).toBe('failed');
    expect(failure('blocked')).toMatch(
      /^Not posted: Facebook asked you to confirm your identity for this Page\. Open the Facebook app/,
    );
  });

  it('holds later posts to that Page scheduled, and still posts elsewhere', async () => {
    platform.failWith = IDENTITY;
    await deliver(short('blocked'));
    platform.failWith = null;

    const later = short('later', { title: 'Another Short', metadata: {} });
    const instagram = short('ig', { connection: 'conn-ig' });
    const otherPage = short('page-2', { connection: 'conn-fb-2' });
    const result = await deliver(later, instagram, otherPage);

    expect(result.batchItemFailures).toEqual([]);
    expect(platform.uploads.sort()).toEqual(['ig', 'page-2']);
    expect(publish('later').status).toBe('scheduled');
    expect(publish('later').scheduled_at).toEqual(expect.any(String));
    expect(failure('later')).toBeUndefined();
  });

  it('posts again once Retry clears the block', async () => {
    platform.failWith = IDENTITY;
    await deliver(short('blocked'));
    platform.failWith = null;

    const { clearPublishBlock } = await import(
      '@kit/publishing/lib/publish-block'
    );
    await clearPublishBlock({ from } as never, 'conn-fb');

    await deliver(short('later', { title: 'Another Short', metadata: {} }));

    expect(platform.uploads).toEqual(['later']);
  });
});
