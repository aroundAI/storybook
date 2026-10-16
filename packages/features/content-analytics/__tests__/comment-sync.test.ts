import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CommentFetch,
  CommentFetchOptions,
} from '../src/lib/audience-comments/fetched';
import {
  CommentScopeError,
  CommentVideoGoneError,
} from '../src/lib/audience-comments/fetched';

/**
 * FILM-1733. The hourly comment sync's bookkeeping, against an in-memory
 * table store: what it reads, what it keeps, what it deletes, and what it
 * records. The SQL rules (RLS, keys, the purge) are pgTAP's
 * (audience-comments.test.sql).
 */

vi.mock('server-only', () => ({}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for the sync */
function memoryClient(
  tables: Record<string, Row[]>,
  rpc: Record<string, Row[]>,
) {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(row: Row) => boolean> = [];
    let range: [number, number] | null = null;
    let action: { kind: 'select' } | { kind: 'delete' } = { kind: 'select' };

    const run = () => {
      const matched = rows().filter((row) => filters.every((f) => f(row)));

      if (action.kind === 'delete') {
        tables[table] = rows().filter((row) => !matched.includes(row));
        return { data: null, error: null, count: matched.length };
      }

      const data = range ? matched.slice(range[0], range[1] + 1) : matched;
      return { data, error: null };
    };

    const builder = {
      select: () => builder,
      delete: () => {
        action = { kind: 'delete' };
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      not: (column: string, _op: string, _value: null) => {
        filters.push(
          (row) => row[column] !== null && row[column] !== undefined,
        );
        return builder;
      },
      lt: (column: string, value: string) => {
        filters.push((row) => String(row[column]) < value);
        return builder;
      },
      order: () => builder,
      range: (a: number, b: number) => {
        range = [a, b];
        return builder;
      },
      upsert: (input: Row | Row[], options: { onConflict: string }) => {
        const keys = options.onConflict.split(',');
        for (const next of Array.isArray(input) ? input : [input]) {
          const existing = rows().find((row) =>
            keys.every((key) => row[key] === next[key]),
          );
          if (existing) Object.assign(existing, next);
          else rows().push({ ...next });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };

    return builder;
  };

  return {
    from,
    rpc: (name: string) =>
      Promise.resolve({ data: rpc[name] ?? [], error: null }),
  };
}

const NOW = new Date('2026-10-20T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const TEAM = 'team-1';
const YT = 'conn-yt';
const IG = 'conn-ig';
const YOUTUBE_READ = 'https://www.googleapis.com/auth/youtube.readonly';

function store(): Record<string, Row[]> {
  return {
    publishes: [
      {
        id: 'pub-yt',
        platform: 'youtube',
        platform_connection_id: YT,
        platform_content_id: 'vid-1',
        published_at: ago(2 * DAY),
        status: 'published',
      },
      {
        id: 'pub-ig',
        platform: 'instagram',
        platform_connection_id: IG,
        platform_content_id: 'media-1',
        published_at: ago(2 * DAY),
        status: 'published',
      },
      {
        id: 'pub-tt',
        platform: 'tiktok',
        platform_connection_id: 'conn-tt',
        platform_content_id: 'tt-1',
        published_at: ago(2 * DAY),
        status: 'published',
      },
    ],
    platform_connections: [
      {
        id: YT,
        account_id: TEAM,
        scopes: [YOUTUBE_READ],
        disconnected_at: null,
      },
      // Instagram before Meta's comment review: no instagram_manage_comments
      {
        id: IG,
        account_id: TEAM,
        scopes: ['instagram_basic', 'pages_read_engagement'],
        disconnected_at: null,
      },
    ],
    audience_comments: [],
    audience_comment_syncs: [],
  };
}

function comment(id: string, at: string) {
  return {
    platformCommentId: id,
    parentPlatformCommentId: null,
    text: `comment ${id}`,
    likeCount: 0,
    replyCount: 0,
    commentedAt: at,
  };
}

let tables: Record<string, Row[]>;
let youtube: ReturnType<
  typeof vi.fn<
    (token: string, id: string, o: CommentFetchOptions) => Promise<CommentFetch>
  >
>;
let instagram: typeof youtube;
let labelComments: ReturnType<typeof vi.fn>;

let runCommentSync: (typeof import('../src/server/comment-sync'))['runCommentSync'];

// The first import is slow (googleapis); paid once, outside any one test,
// so a test run alone (vitest -t, the mutation guards) does not time out
beforeAll(async () => {
  ({ runCommentSync } = await import('../src/server/comment-sync'));
}, 60_000);

async function sync(rpc: Record<string, Row[]> = {}) {
  return runCommentSync({
    client: memoryClient(tables, rpc) as never,
    now: NOW,
    fetchers: { youtube, instagram, facebook: vi.fn() },
    ensureValidToken: async () => ({ valid: true, accessToken: 'token' }),
    labelComments,
  });
}

beforeEach(() => {
  tables = store();
  youtube = vi.fn(async () => ({
    comments: [comment('yt-1', ago(DAY)), comment('yt-2', ago(DAY / 2))],
    complete: true,
  }));
  instagram = vi.fn();
  labelComments = vi.fn(async () => undefined);
});

describe('the hourly comment sync', () => {
  it('stores a video’s comments with the team and channel they belong to, and records the read', async () => {
    const result = await sync();

    expect(youtube).toHaveBeenCalledWith('token', 'vid-1', {
      since: undefined,
      maxPages: 50,
    });
    expect(tables.audience_comments).toHaveLength(2);
    expect(tables.audience_comments![0]).toMatchObject({
      account_id: TEAM,
      platform_connection_id: YT,
      publish_id: 'pub-yt',
      platform: 'youtube',
      platform_comment_id: 'yt-1',
      fetched_at: NOW.toISOString(),
    });
    expect(
      tables.audience_comment_syncs!.find((s) => s.publish_id === 'pub-yt'),
    ).toMatchObject({
      last_status: 'ok',
      last_synced_at: NOW.toISOString(),
      last_refreshed_at: NOW.toISOString(),
    });
    expect(result.stored).toBe(2);
  });

  it('never asks a platform with no comment API', async () => {
    await sync();

    expect(
      tables.audience_comment_syncs!.some((s) => s.publish_id === 'pub-tt'),
    ).toBe(false);
  });

  it('does not call Instagram for a channel without the comment permission, and records why', async () => {
    const result = await sync();

    expect(instagram).not.toHaveBeenCalled();
    expect(result.notAuthorised).toBe(1);
    expect(
      tables.audience_comment_syncs!.find((s) => s.publish_id === 'pub-ig'),
    ).toMatchObject({ last_status: 'not_authorised' });
  });

  it('deletes every YouTube comment not returned for 30 days, whatever else happens', async () => {
    tables.publishes = [];
    tables.audience_comments = [
      {
        id: 'old',
        platform: 'youtube',
        publish_id: 'gone',
        fetched_at: ago(31 * DAY),
      },
      {
        id: 'fresh',
        platform: 'youtube',
        publish_id: 'gone',
        fetched_at: ago(29 * DAY),
      },
      {
        id: 'meta',
        platform: 'instagram',
        publish_id: 'gone',
        fetched_at: ago(90 * DAY),
      },
    ];

    const result = await sync();

    expect(result.expired).toBe(1);
    expect(tables.audience_comments.map((c) => c.id)).toEqual([
      'fresh',
      'meta',
    ]);
  });

  it('a complete refresh removes the comments the platform no longer has', async () => {
    tables.audience_comments = [
      {
        id: 'deleted-on-youtube',
        platform: 'youtube',
        publish_id: 'pub-yt',
        platform_comment_id: 'yt-0',
        fetched_at: ago(8 * DAY),
      },
    ];

    const result = await sync();

    expect(result.removed).toBe(1);
    expect(
      tables.audience_comments!.map((c) => c.platform_comment_id).sort(),
    ).toEqual(['yt-1', 'yt-2']);
  });

  it('an incomplete read removes nothing', async () => {
    youtube.mockResolvedValueOnce({
      comments: [comment('yt-1', ago(DAY))],
      complete: false,
    });
    tables.audience_comments = [
      {
        id: 'beyond-the-page-cap',
        platform: 'youtube',
        publish_id: 'pub-yt',
        platform_comment_id: 'yt-0',
        fetched_at: ago(8 * DAY),
      },
    ];

    await sync();

    expect(
      tables.audience_comments!.some((c) => c.id === 'beyond-the-page-cap'),
    ).toBe(true);
    expect(
      tables.audience_comment_syncs!.find((s) => s.publish_id === 'pub-yt')!
        .last_refreshed_at,
    ).toBeUndefined();
  });

  it('between refreshes reads only new comments', async () => {
    tables.audience_comment_syncs = [
      {
        publish_id: 'pub-yt',
        account_id: TEAM,
        last_synced_at: ago(7 * 3_600_000),
        last_refreshed_at: ago(DAY),
        last_status: 'ok',
        consecutive_failures: 0,
        updated_at: ago(7 * 3_600_000),
      },
    ];

    await sync();

    expect(youtube).toHaveBeenCalledWith('token', 'vid-1', {
      since: new Date(NOW.getTime() - 8 * 3_600_000),
      maxPages: 5,
    });
  });

  it('records a refused read as not authorised, and a failure with its count', async () => {
    youtube.mockRejectedValueOnce(
      new CommentScopeError('youtube', 'insufficientPermissions'),
    );
    await sync();
    expect(
      tables.audience_comment_syncs!.find((s) => s.publish_id === 'pub-yt'),
    ).toMatchObject({ last_status: 'not_authorised' });

    tables = store();
    youtube.mockRejectedValueOnce(
      new CommentVideoGoneError('youtube', 'vid-1'),
    );
    const result = await sync();
    expect(result.failed).toBe(1);
    expect(
      tables.audience_comment_syncs!.find((s) => s.publish_id === 'pub-yt'),
    ).toMatchObject({
      last_status: 'failed',
      last_error: 'The platform no longer has this video',
      consecutive_failures: 1,
    });
  });

  it('skips a disconnected channel', async () => {
    tables.platform_connections![0]!.disconnected_at = ago(DAY);

    await sync();

    expect(youtube).not.toHaveBeenCalled();
  });

  it('hands the projects with unlabelled comments to the labeller', async () => {
    const result = await sync({
      projects_with_unlabelled_comments: [
        { account_id: TEAM, project_id: 'project-1' },
      ],
    });

    expect(labelComments).toHaveBeenCalledWith([
      { accountId: TEAM, projectId: 'project-1' },
    ]);
    expect(result.projectsToLabel).toBe(1);
  });
});
