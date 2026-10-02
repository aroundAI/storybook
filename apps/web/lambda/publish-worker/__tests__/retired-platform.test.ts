import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-717. LinkedIn is retired. A LinkedIn job already on the queue when it
 * was retired (a scheduled publish, a social post) is answered, not retried:
 * the row is marked failed with a sentence that says LinkedIn is retired,
 * the message is acknowledged, and LinkedIn is never called.
 */

const db = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  reads: [] as string[],
}));

// The video and thumbnail checks run after the platform check; a retired
// job never reaches them.
vi.mock('@kit/publishing/lib/owned-episode-video', () => ({
  EPISODE_VIDEO_PUBLISH_REFUSAL: 'not the episode video',
  ownedEpisodeVideo: vi.fn(),
}));
vi.mock('@kit/publishing/lib/owned-thumbnail', () => ({
  ownedEpisodeThumbnail: vi.fn(),
}));
vi.mock('@kit/publishing/lib/uploaded-file-duration', () => ({
  recordUploadedFileDuration: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const builder = {
        select: () => {
          db.reads.push(table);
          return builder;
        },
        eq: () => builder,
        single: async () => ({
          data: { metadata: { kept: true } },
          error: null,
        }),
        maybeSingle: async () => ({ data: null, error: null }),
        update(values: Record<string, unknown>) {
          db.updates.push({ table, values });
          return { eq: async () => ({ error: null }) };
        },
      };
      return builder;
    },
  }),
}));

function event(body: Record<string, unknown>): SQSEvent {
  return {
    Records: [{ messageId: 'm-1', body: JSON.stringify(body) }],
  } as unknown as SQSEvent;
}

const RETIRED_SENTENCE =
  'LinkedIn is retired: this app no longer publishes to it. Your LinkedIn connection and what you published there are kept.';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db.updates = [];
  db.reads = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('CONNECTIONS_TABLE_NAME', '');
  vi.stubEnv('WEBSOCKET_ENDPOINT', '');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a job for a retired platform (FILM-717)', () => {
  it('marks a LinkedIn publish failed as retired and acknowledges it', async () => {
    const { handler } = await import('../index');

    const result = await handler(
      event({
        type: 'publish',
        publishId: 'publish-1',
        platform: 'linkedin',
        platformConnectionId: 'conn-li',
        userId: 'user-1',
        episodeId: 'episode-1',
        videoUrl: 'https://cdn.test/v.mp4',
        title: 't',
        description: 'd',
        tags: [],
        metadata: {},
      }),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updates).toEqual([
      {
        table: 'publishes',
        values: {
          status: 'failed',
          metadata: expect.objectContaining({
            kept: true,
            error: RETIRED_SENTENCE,
            errorCode: 'PLATFORM_RETIRED',
          }),
        },
      },
    ]);
  });

  it('marks a queued LinkedIn social post failed as retired and acknowledges it', async () => {
    const { handler } = await import('../index');

    const result = await handler(
      event({
        type: 'social_text_post',
        socialPostId: 'post-1',
        platform: 'linkedin',
        platformConnectionId: 'conn-li',
        userId: 'user-1',
        text: 'hello',
        visibility: 'PUBLIC',
        authorUrn: 'urn:li:person:1',
      }),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updates).toEqual([
      {
        table: 'social_posts',
        values: {
          status: 'failed',
          metadata: expect.objectContaining({
            kept: true,
            error: RETIRED_SENTENCE,
            errorCode: 'PLATFORM_RETIRED',
          }),
        },
      },
    ]);
  });
});
