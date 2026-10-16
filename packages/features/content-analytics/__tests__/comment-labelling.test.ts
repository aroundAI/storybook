import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1733. Who labels a project's comments: a server run, opened as the
 * team's owner and dispatched, unless the team cannot have one (server
 * generation off, no model, no spend left), in which case the comments wait
 * for its own AI over MCP. Neither that nor a run already open is an error.
 */

vi.mock('server-only', () => ({}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const IN_PROGRESS = 'This stage is already being generated.';
const OFF = 'This team has server generation turned off.';

const gateway = vi.hoisted(() => ({
  opened: [] as Array<{
    params: Record<string, unknown>;
    ctx: Record<string, unknown>;
  }>,
  refuse: new Map<string, string>(),
  dispatched: 0,
}));

vi.mock('@kit/ai-gateway', () => ({
  STAGE_IN_PROGRESS_REFUSAL: 'This stage is already being generated.',
  runRefusalMessage: (error: unknown) =>
    error instanceof Error && error.name === 'Refusal' ? error.message : null,
  openRunForJob: async (
    params: { target: { projectId: string } } & Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => {
    gateway.opened.push({ params, ctx });
    const refusal = gateway.refuse.get(params.target.projectId);
    if (refusal === 'crash') throw new Error('database down');
    if (refusal) throw Object.assign(new Error(refusal), { name: 'Refusal' });
    return { dispatch: async () => void gateway.dispatched++ };
  },
}));

const owners = [
  { id: 'team-1', primary_owner_user_id: 'owner-1' },
  { id: 'team-2', primary_owner_user_id: 'owner-2' },
];

const client = {
  from: () => ({
    select: () => ({
      in: (_: string, ids: string[]) =>
        Promise.resolve({
          data: owners.filter((o) => ids.includes(o.id)),
          error: null,
        }),
    }),
  }),
};

let labelCommentsOnServer: (typeof import('../src/server/comment-labelling'))['labelCommentsOnServer'];
let serverCommentLabellingEnabled: (typeof import('../src/server/comment-labelling'))['serverCommentLabellingEnabled'];

beforeAll(async () => {
  ({ labelCommentsOnServer, serverCommentLabellingEnabled } = await import(
    '../src/server/comment-labelling'
  ));
}, 60_000);

beforeEach(() => {
  gateway.opened.length = 0;
  gateway.refuse.clear();
  gateway.dispatched = 0;
});

describe('opening the server’s labelling runs', () => {
  it('opens one run per project, as the team’s owner, and dispatches it', async () => {
    const outcomes = await labelCommentsOnServer(client as never, [
      { accountId: 'team-1', projectId: 'p-1' },
      { accountId: 'team-2', projectId: 'p-2' },
    ]);

    expect(outcomes.dispatched).toBe(2);
    expect(gateway.dispatched).toBe(2);
    expect(gateway.opened[0]).toMatchObject({
      params: {
        jobType: 'comment-labels',
        userId: 'owner-1',
        target: { accountId: 'team-1', projectId: 'p-1' },
      },
      ctx: { accountId: 'team-1', userId: 'owner-1' },
    });
  });

  it('leaves a team that has server generation off to its own AI, and a running project alone', async () => {
    gateway.refuse.set('p-1', OFF);
    gateway.refuse.set('p-2', IN_PROGRESS);

    const outcomes = await labelCommentsOnServer(client as never, [
      { accountId: 'team-1', projectId: 'p-1' },
      { accountId: 'team-2', projectId: 'p-2' },
    ]);

    expect(outcomes).toMatchObject({
      dispatched: 0,
      left_for_mcp: 1,
      already_running: 1,
      failed: 0,
    });
  });

  it('counts a failure without stopping the other projects', async () => {
    gateway.refuse.set('p-1', 'crash');

    const outcomes = await labelCommentsOnServer(client as never, [
      { accountId: 'team-1', projectId: 'p-1' },
      { accountId: 'team-2', projectId: 'p-2' },
      { accountId: 'team-none', projectId: 'p-3' },
    ]);

    expect(outcomes).toMatchObject({ failed: 1, dispatched: 1, no_owner: 1 });
  });
});

describe('whether the server labels at all', () => {
  it('is off unless SERVER_COMMENT_LABELS_ENABLED says so: no cloud model spend by default', () => {
    expect(serverCommentLabellingEnabled({})).toBe(false);
    expect(
      serverCommentLabellingEnabled({ SERVER_COMMENT_LABELS_ENABLED: '' }),
    ).toBe(false);
    expect(
      serverCommentLabellingEnabled({ SERVER_COMMENT_LABELS_ENABLED: 'false' }),
    ).toBe(false);
    expect(
      serverCommentLabellingEnabled({ SERVER_COMMENT_LABELS_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      serverCommentLabellingEnabled({ SERVER_COMMENT_LABELS_ENABLED: ' 1 ' }),
    ).toBe(true);
  });
});
