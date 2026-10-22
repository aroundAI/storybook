import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';

/**
 * KB-214. A YouTube post uploaded at its slot went public in 360p. The
 * worker now uploads a staged post private, with YouTube's publish time at
 * its slot, and leaves the row scheduled with the video's id; nothing sends
 * it again. A second post of a video already staged on the channel is
 * refused (KB-213). The scheduled job's check message reaches the HD gate.
 *
 * The real job guard runs against an in-memory database; YouTube and the
 * token are stood in for.
 */

const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const SUPABASE = 'https://abcdefghijklmnop.supabase.co';
const VIDEO = `${SUPABASE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en.mp4`;
const SLOT = '2026-11-05T14:00:00.000Z';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  tables: new Map<string, Map<string, Record<string, unknown>>>(),
}));

const youtube = vi.hoisted(() => ({
  uploads: [] as Array<{ publishId: string; staged: unknown }>,
  checked: [] as string[],
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
    eq: (column: string, value: unknown) => (eqs.push([column, value]), q),
    in: (column: string, list: unknown[]) => (ins.push([column, list]), q),
    update: (next: Record<string, unknown>) => ((values = next), q),
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
    accessToken: 'yt-token',
    platformAccountId: 'UC1',
  })),
}));
vi.mock('../job-thumbnail', () => ({
  missingLongVideoThumbnail: vi.fn(async () => null),
}));
vi.mock('../handlers/youtube', () => ({
  uploadToYouTube: vi.fn(async (_token: string, job: PublishJobMessage) => {
    youtube.uploads.push({ publishId: job.publishId, staged: job.staged });
    return {
      contentId: `video-${job.publishId}`,
      url: `https://www.youtube.com/watch?v=video-${job.publishId}`,
    };
  }),
  youtubeStagingApi: vi.fn(() => ({})),
}));
vi.mock('@kit/publishing/lib/youtube-staged-check', () => ({
  checkStagedYouTube: vi.fn(async (_client: unknown, connectionId: string) => {
    youtube.checked.push(connectionId);
    return { errors: [] };
  }),
}));
vi.mock('@kit/publishing/lib/owned-episode-video', () => ({
  EPISODE_VIDEO_PUBLISH_REFUSAL: 'not the episode video',
  ownedEpisodeVideo: vi.fn(async (url: string) => url),
}));
vi.mock('@kit/publishing/lib/uploaded-file-duration', () => ({
  recordUploadedFileDuration: vi.fn(),
}));
vi.mock('@kit/publishing/lib/mp4-facts', () => ({
  readMp4Facts: vi.fn(async () => ({ durationSeconds: 600 })),
}));

function longVideo(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    status: 'queued',
    episode_id: EPISODE,
    platform_connection_id: 'conn-yt',
    platform: 'youtube',
    platform_content_id: null,
    platform_url: null,
    published_at: null,
    created_at: '2026-11-05T11:00:00Z',
    content_type: 'full',
    title: 'The harbour at dusk',
    language: 'en',
    scheduled_at: SLOT,
    metadata: { madeForKids: false, categoryId: '22' },
    episode: {
      project_id: 'p1',
      deleted_at: null,
      project: { account_id: 'a1' },
    },
    connection: { account_id: 'a1' },
    ...overrides,
  };
}

function job(
  row: Row,
  staged?: PublishJobMessage['staged'],
): PublishJobMessage {
  return {
    type: 'publish',
    publishId: row.id,
    platform: 'youtube',
    platformConnectionId: 'conn-yt',
    userId: 'user-1',
    episodeId: EPISODE,
    videoUrl: VIDEO,
    title: row.title as string,
    description: '',
    tags: [],
    metadata: row.metadata as Record<string, unknown>,
    ...(staged && { staged }),
  };
}

async function deliver(...messages: Array<Record<string, unknown>>) {
  const { handler } = await import('../index');
  return handler({
    Records: messages.map((message, n) => ({
      messageId: `m-${n}`,
      body: JSON.stringify(message),
    })),
  } as unknown as SQSEvent);
}

const publish = (id: string) => table('publishes').get(id)!;

beforeEach(() => {
  db.tables.clear();
  table('platform_connections').set('conn-yt', {
    id: 'conn-yt',
    platform: 'youtube',
    platform_account_name: 'Harbour',
    youtube_made_for_kids: false,
    youtube_category_id: '22',
    metadata: { long_uploads_status: 'allowed' },
  });
  table('episodes').set(EPISODE, { id: EPISODE, project_id: 'p1' });
  youtube.uploads = [];
  youtube.checked = [];
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

describe('a staged YouTube upload (KB-214)', () => {
  it('uploads with the slot as YouTube’s publish time and keeps the post scheduled', async () => {
    const row = longVideo('p1');
    table('publishes').set('p1', row);

    await deliver({ ...job(row, { publishAt: SLOT }) });

    expect(youtube.uploads).toEqual([
      { publishId: 'p1', staged: { publishAt: SLOT } },
    ]);
    expect(publish('p1')).toMatchObject({
      status: 'scheduled',
      platform_content_id: 'video-p1',
      platform_url: 'https://www.youtube.com/watch?v=video-p1',
      published_at: null,
      metadata: {
        youtube: { videoId: 'video-p1', publishAt: SLOT, delays: [] },
      },
    });
  });

  it('records a breaking upload as going public when ready', async () => {
    const row = longVideo('b1');
    table('publishes').set('b1', row);

    await deliver({ ...job(row, { publishAt: SLOT, goLiveWhenReady: true }) });

    expect(publish('b1')).toMatchObject({
      status: 'scheduled',
      metadata: { youtube: { videoId: 'video-b1', goLiveWhenReady: true } },
    });
  });

  it('publishes an unstaged upload as before', async () => {
    const row = longVideo('p1');
    table('publishes').set('p1', row);

    await deliver({ ...job(row) });

    expect(publish('p1').status).toBe('published');
  });

  it('refuses a second post of a video already staged on the channel (KB-213)', async () => {
    table('publishes').set(
      'first',
      longVideo('first', {
        status: 'scheduled',
        platform_url: 'https://www.youtube.com/watch?v=video-first',
        metadata: {
          youtube: { videoId: 'video-first', publishAt: SLOT, delays: [] },
        },
      }),
    );
    const second = longVideo('second');
    table('publishes').set('second', second);

    await deliver({ ...job(second, { publishAt: SLOT }) });

    expect(youtube.uploads).toEqual([]);
    expect(publish('second').status).toBe('failed');
    expect((publish('second').metadata as { error: string }).error).toMatch(
      /^Already uploaded to this account as https:\/\/www.youtube.com\/watch\?v=video-first/,
    );
  });

  it('refuses at staging a long video an unverified channel cannot take (KB-205)', async () => {
    table('platform_connections').get('conn-yt')!.metadata = {
      long_uploads_status: 'eligible',
    };
    const { readMp4Facts } = await import('@kit/publishing/lib/mp4-facts');
    vi.mocked(readMp4Facts).mockResolvedValueOnce({
      durationSeconds: 20 * 60,
    } as Awaited<ReturnType<typeof readMp4Facts>>);
    const row = longVideo('p1');
    table('publishes').set('p1', row);

    await deliver({ ...job(row, { publishAt: SLOT }) });

    expect(youtube.uploads).toEqual([]);
    expect(publish('p1').status).toBe('failed');
  });

  it('runs the staged check for the channel the scheduled job names', async () => {
    const result = await deliver({
      type: 'youtube-staged-check',
      platform: 'youtube',
      platformConnectionId: 'conn-yt',
    });

    expect(youtube.checked).toEqual(['conn-yt']);
    expect(result.batchItemFailures).toEqual([]);
  });
});
