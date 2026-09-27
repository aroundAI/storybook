import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-47 (publishing) and KB-109. The unpublish actions queue jobs the
 * service-role publish worker runs with a connection's token, and the
 * publish actions decrypt a connection's token before anything else.
 *
 * Reproduced on main (2026-09-25): a project viewer and an account member
 * off the project could read an episode's publishes, their update to
 * 'deleting' matched no row, and the delete job was sent anyway — the
 * worker then removed the video from YouTube. And a user in two accounts
 * could publish one account's episode with the other account's channel.
 *
 * The harness plays RLS: publishes are readable by any member of the
 * account, writable by owner/admin/member of the project (`publishes_update`).
 */

const EPISODE = '10000000-0000-4000-8000-000000000001';
const PROJECT = '20000000-0000-4000-8000-000000000001';
const ACCOUNT = '30000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT = '30000000-0000-4000-8000-000000000002';
const PUBLISH = '40000000-0000-4000-8000-000000000001';
const CONNECTION = '50000000-0000-4000-8000-000000000001';
const FOREIGN_CONNECTION = '50000000-0000-4000-8000-000000000002';
const POST = '60000000-0000-4000-8000-000000000001';

// An episode's own upload: KB-123 sends nothing else, so the channel check
// here is the only thing that can refuse
const STORAGE = 'https://abcdefghijklmnop.supabase.co';
const OWN_VIDEO = `${STORAGE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
vi.stubEnv('STORAGE_PROVIDER', '');

const OWNER = '70000000-0000-4000-8000-000000000001';
const ADMIN = '70000000-0000-4000-8000-000000000002';
const MEMBER = '70000000-0000-4000-8000-000000000003';
const VIEWER = '70000000-0000-4000-8000-000000000004';
const OFF_PROJECT = '70000000-0000-4000-8000-000000000005';

const ROLES: Record<string, string> = {
  [OWNER]: 'owner',
  [ADMIN]: 'admin',
  [MEMBER]: 'member',
  [VIEWER]: 'viewer',
};

const WRITERS = new Set(['owner', 'admin', 'member']);

const state = vi.hoisted(() => ({
  caller: '',
  publishStatus: 'published',
  publishConnection: '',
  /** RLS refusing the update although the caller passed the role check */
  updateMatchesNothing: false,
  sent: [] as Array<Record<string, unknown>>,
  tokensRequested: [] as string[],
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction:
    (fn: (data: unknown, user: { id: string }) => Promise<unknown>) =>
    (data: unknown) =>
      fn(data, { id: state.caller }),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({
    send: async (command: { input: { MessageBody: string } }) => {
      state.sent.push(JSON.parse(command.input.MessageBody));
      return {};
    },
  })),
  SendMessageCommand: vi.fn((input: unknown) => ({ input })),
}));
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: async (connectionId: string) => {
    state.tokensRequested.push(connectionId);
    return { error: 'stopped here by the test' };
  },
}));

type Filters = Record<string, unknown>;

function rows(table: string, filters: Filters): Record<string, unknown>[] {
  const role = ROLES[state.caller];
  const inAccount = state.caller !== '';

  switch (table) {
    case 'episodes':
      return filters.id === EPISODE && inAccount
        ? [
            {
              project_id: PROJECT,
              final_video_url: OWN_VIDEO,
              thumbnail_url: null,
              localized_videos: null,
              shorts_groups: null,
              project: { account_id: ACCOUNT },
            },
          ]
        : [];
    case 'project_members':
      return filters.user_id === state.caller && role ? [{ role }] : [];
    case 'publishes':
      return inAccount
        ? [
            {
              id: PUBLISH,
              episode_id: EPISODE,
              status: state.publishStatus,
              platform: 'youtube',
              platform_content_id: 'VIDEO123',
              platform_connection_id: state.publishConnection || CONNECTION,
              episodes: {
                final_video_url: OWN_VIDEO,
                thumbnail_url: null,
                project: { account_id: ACCOUNT },
              },
            },
          ]
        : [];
    case 'platform_connections': {
      // The caller also belongs to OTHER_ACCOUNT, so RLS shows its channel
      const all = [
        { id: CONNECTION, account_id: ACCOUNT },
        { id: FOREIGN_CONNECTION, account_id: OTHER_ACCOUNT },
      ];
      return all.filter((c) => !filters.id || c.id === filters.id);
    }
    case 'social_posts':
      return [
        {
          id: POST,
          account_id: ACCOUNT,
          final_text: 'Hello',
          platform_connection_id: FOREIGN_CONNECTION,
          visibility: 'PUBLIC',
          metadata: {},
        },
      ];
    default:
      return [];
  }
}

function builder(table: string) {
  const filters: Filters = {};
  let op: 'select' | 'update' = 'select';

  const result = () => {
    const found = rows(table, filters);

    if (op === 'update') {
      // publishes_update: owner, admin or member of the project
      const writable =
        WRITERS.has(ROLES[state.caller] ?? '') && !state.updateMatchesNothing
          ? found
          : [];
      return { data: writable, error: null };
    }

    return { data: found, error: null };
  };

  const b = {
    select: () => b,
    update: () => {
      op = 'update';
      return b;
    },
    insert: () => b,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return b;
    },
    is: () => b,
    in: () => b,
    order: () => b,
    single: async () => {
      const { data } = result();
      return data[0]
        ? { data: data[0], error: null }
        : { data: null, error: { message: 'no rows' } };
    },
    maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve(result()),
  };

  return b;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: (table: string) => builder(table) }),
}));

beforeEach(() => {
  state.sent.length = 0;
  state.tokensRequested.length = 0;
  state.publishStatus = 'published';
  state.publishConnection = '';
  state.updateMatchesNothing = false;
  process.env.PUBLISH_QUEUE_URL = 'https://sqs.test/publish';
});

async function actions() {
  vi.resetModules();
  process.env.PUBLISH_QUEUE_URL = 'https://sqs.test/publish';
  return import('../src/server/publish-actions');
}

describe('unpublishAction', () => {
  it.each([
    ['a project viewer', VIEWER],
    ['an account member off the project', OFF_PROJECT],
    ['a project member', MEMBER],
  ])('refuses %s and queues nothing', async (_who, caller) => {
    state.caller = caller;
    const { unpublishAction } = await actions();

    const result = await unpublishAction({ publishId: PUBLISH });

    expect(result).toEqual({
      ok: false,
      error: 'Only project owners and admins can take a published video down.',
    });
    expect(state.sent).toEqual([]);
  });

  it.each([
    ['the project owner', OWNER],
    ['a project admin', ADMIN],
  ])('queues the delete for %s', async (_who, caller) => {
    state.caller = caller;
    const { unpublishAction } = await actions();

    await expect(unpublishAction({ publishId: PUBLISH })).resolves.toEqual({
      ok: true,
      data: { success: true },
    });
    expect(state.sent).toEqual([
      expect.objectContaining({
        type: 'delete',
        publishId: PUBLISH,
        userId: caller,
      }),
    ]);
  });
});

describe('deleteEpisodePublishesAction', () => {
  it.each([
    ['a project viewer', VIEWER],
    ['an account member off the project', OFF_PROJECT],
    ['a project member', MEMBER],
  ])('refuses %s and queues nothing', async (_who, caller) => {
    state.caller = caller;
    const { deleteEpisodePublishesAction } = await actions();

    const result = await deleteEpisodePublishesAction({ episodeId: EPISODE });

    expect(result).toEqual({
      ok: false,
      error: 'Only project owners and admins can take a published video down.',
    });
    expect(state.sent).toEqual([]);
  });

  it('queues one delete per publish the update marked, for an admin', async () => {
    state.caller = ADMIN;
    const { deleteEpisodePublishesAction } = await actions();

    await expect(
      deleteEpisodePublishesAction({ episodeId: EPISODE }),
    ).resolves.toEqual({
      ok: true,
      data: { success: true, deletedCount: 1, platformErrors: [] },
    });
    expect(state.sent).toHaveLength(1);
  });

  it('queues nothing for a publish its update did not mark', async () => {
    state.caller = ADMIN;
    state.updateMatchesNothing = true;
    const { deleteEpisodePublishesAction } = await actions();

    await deleteEpisodePublishesAction({ episodeId: EPISODE });

    expect(state.sent).toEqual([]);
  });
});

describe('a channel of another account (KB-109)', () => {
  it('publishToAllAction refuses it before any token is read', async () => {
    state.caller = OWNER;
    const { publishToAllAction } = await actions();

    const result = await publishToAllAction({
      episodeId: EPISODE,
      platforms: [
        {
          platform: 'tiktok',
          connectionId: FOREIGN_CONNECTION,
          title: 'T',
          description: 'D',
        },
      ],
    } as Parameters<typeof publishToAllAction>[0]);

    expect(result).toEqual({
      ok: false,
      error: "That channel isn't connected to this account.",
    });
    expect(state.tokensRequested).toEqual([]);
  });

  it('retryPublishAction refuses it before any token is read', async () => {
    state.caller = OWNER;
    state.publishStatus = 'failed';
    state.publishConnection = FOREIGN_CONNECTION;
    const { retryPublishAction } = await actions();

    const result = await retryPublishAction({ publishId: PUBLISH });

    expect(result).toEqual({
      ok: false,
      error: "That channel isn't connected to this account.",
    });
    expect(state.tokensRequested).toEqual([]);
  });

  it('publishSocialPostAction refuses it before any token is read', async () => {
    state.caller = OWNER;
    vi.resetModules();
    const { publishSocialPostAction } = await import(
      '../src/server/social-post-actions'
    );

    const result = await publishSocialPostAction({ postId: POST });

    expect(result).toEqual({
      ok: false,
      error: "That channel isn't connected to this account.",
    });
    expect(state.tokensRequested).toEqual([]);
  });
});
