import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type LlmJobAuthzClient,
  authorizeEpisodeTarget,
  authorizeEpisodeTargets,
  authorizeProjectTarget,
  chainedLlmJobTarget,
  noTenantLlmJobTarget,
} from '../src/lib/server/llm-job-target';
import { payloadForTarget } from '../src/lib/server/sqs-helper';

/**
 * Who may queue an LLM job on an episode or project (KB-31).
 *
 * The worker runs on the service-role key, so these are the only check
 * between a caller and the ids a job names. The rule is KB-28's
 * `can_write_project`: a row the caller can merely *read* — a public or
 * unlisted project's, readable by every signed-in user — is not enough.
 */

const A_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const A_PROJECT = '22222222-2222-4222-8222-222222222222';
const A_EPISODE = '33333333-3333-4333-8333-333333333333';
const B_PROJECT = '44444444-4444-4444-8444-444444444444';
const B_EPISODE = '55555555-5555-4555-8555-555555555555';

interface FakeDb {
  /** Rows the caller can read, as RLS would return them. */
  episodes: Array<{
    id: string;
    project_id: string;
    project: { account_id: string } | null;
  }>;
  projects: Array<{ id: string; account_id: string }>;
  /** Projects `can_write_project` answers true for. */
  writable: Set<string>;
  rpcError?: string;
}

const rpc = vi.fn();

function fakeClient(db: FakeDb): LlmJobAuthzClient {
  rpc.mockImplementation(
    async (_fn: string, args: { target_project_id: string }) =>
      db.rpcError
        ? { data: null, error: { message: db.rpcError } }
        : { data: db.writable.has(args.target_project_id), error: null },
  );

  return {
    from(relation) {
      const rows: Array<Record<string, unknown>> =
        relation === 'episodes' ? db.episodes : db.projects;

      return {
        select() {
          let filtered = rows;

          const builder = {
            eq(column: string, value: string) {
              filtered = filtered.filter((row) => row[column] === value);
              return builder;
            },
            is() {
              return builder;
            },
            in(column: string, values: string[]) {
              filtered = filtered.filter((row) =>
                values.includes(row[column] as string),
              );
              return builder;
            },
            order() {
              return builder;
            },
            range(from: number, to: number) {
              filtered = filtered.slice(from, to + 1);
              return builder;
            },
            maybeSingle() {
              return Promise.resolve({
                data: filtered[0] ?? null,
                error: null,
              });
            },
            then<R>(
              resolve: (value: {
                data: unknown[];
                error: null;
              }) => R | PromiseLike<R>,
            ) {
              return Promise.resolve({ data: filtered, error: null }).then(
                resolve,
              );
            },
          };

          return builder;
        },
      };
    },
    rpc,
  } as LlmJobAuthzClient;
}

function aDb(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    episodes: [
      {
        id: A_EPISODE,
        project_id: A_PROJECT,
        project: { account_id: A_ACCOUNT },
      },
    ],
    projects: [{ id: A_PROJECT, account_id: A_ACCOUNT }],
    writable: new Set([A_PROJECT]),
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe('authorizeEpisodeTarget', () => {
  it('gives a writer a target carrying the episode’s own project and account', async () => {
    const target = await authorizeEpisodeTarget(fakeClient(aDb()), A_EPISODE);

    expect(target).toMatchObject({
      accountId: A_ACCOUNT,
      projectId: A_PROJECT,
      episodeId: A_EPISODE,
    });
    expect(rpc).toHaveBeenCalledWith('can_write_project', {
      target_project_id: A_PROJECT,
    });
  });

  it('refuses an episode the caller cannot read at all', async () => {
    const target = await authorizeEpisodeTarget(
      fakeClient(aDb({ episodes: [] })),
      A_EPISODE,
    );

    expect(target).toBeNull();
  });

  it('refuses an episode the caller can read but not write — a public project’s', async () => {
    const target = await authorizeEpisodeTarget(
      fakeClient(aDb({ writable: new Set() })),
      A_EPISODE,
    );

    expect(target).toBeNull();
  });

  it('throws when the write check itself fails, rather than calling it a refusal', async () => {
    await expect(
      authorizeEpisodeTarget(
        fakeClient(aDb({ rpcError: 'connection reset' })),
        A_EPISODE,
      ),
    ).rejects.toThrow('connection reset');
  });
});

describe('authorizeEpisodeTargets', () => {
  it('splits a batch into allowed and denied, one write check per project', async () => {
    const db = aDb({
      episodes: [
        {
          id: A_EPISODE,
          project_id: A_PROJECT,
          project: { account_id: A_ACCOUNT },
        },
        {
          id: B_EPISODE,
          project_id: B_PROJECT,
          project: { account_id: A_ACCOUNT },
        },
      ],
    });
    const missing = '66666666-6666-4666-8666-666666666666';

    const { allowed, denied } = await authorizeEpisodeTargets(fakeClient(db), [
      A_EPISODE,
      B_EPISODE,
      missing,
    ]);

    expect([...allowed.keys()]).toEqual([A_EPISODE]);
    expect(denied).toEqual([B_EPISODE, missing]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('authorizeProjectTarget', () => {
  it('gives a writer the project’s own account', async () => {
    const target = await authorizeProjectTarget(fakeClient(aDb()), A_PROJECT);

    expect(target).toMatchObject({ accountId: A_ACCOUNT, projectId: A_PROJECT });
  });

  it('refuses a readable project the caller cannot write to', async () => {
    const target = await authorizeProjectTarget(
      fakeClient(aDb({ writable: new Set() })),
      A_PROJECT,
    );

    expect(target).toBeNull();
  });

  it('refuses a project the caller cannot read', async () => {
    const target = await authorizeProjectTarget(
      fakeClient(aDb({ projects: [] })),
      A_PROJECT,
    );

    expect(target).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('payloadForTarget (what queueLlmJob sends)', () => {
  it('stamps the target’s account over whatever the caller put there', async () => {
    const target = await authorizeEpisodeTarget(fakeClient(aDb()), A_EPISODE);

    expect(
      payloadForTarget(target!, {
        episodeId: A_EPISODE,
        accountId: 'the-callers-first-membership',
      }),
    ).toMatchObject({
      accountId: A_ACCOUNT,
      projectId: A_PROJECT,
      episodeId: A_EPISODE,
    });
  });

  it('throws when the payload names a project other than the authorised one', async () => {
    const target = await authorizeEpisodeTarget(fakeClient(aDb()), A_EPISODE);

    expect(() =>
      payloadForTarget(target!, { episodeId: A_EPISODE, projectId: B_PROJECT }),
    ).toThrow('payload.projectId is not the authorised target');
  });

  it('throws when a project-scoped target is used to name an episode', async () => {
    const target = await authorizeProjectTarget(fakeClient(aDb()), A_PROJECT);

    expect(() =>
      payloadForTarget(target!, { episodeId: B_EPISODE }),
    ).toThrow('payload.episodeId is not the authorised target');
  });

  it('records a no-tenant job on the caller’s personal account', () => {
    expect(
      payloadForTarget(noTenantLlmJobTarget('user-1'), { items: [] }),
    ).toEqual({ items: [], accountId: 'user-1' });
  });

  it('keeps a chained job on its parent’s target', () => {
    expect(
      payloadForTarget(
        chainedLlmJobTarget({
          accountId: A_ACCOUNT,
          projectId: A_PROJECT,
          episodeId: A_EPISODE,
        }),
        { episodeId: A_EPISODE },
      ),
    ).toEqual({
      accountId: A_ACCOUNT,
      projectId: A_PROJECT,
      episodeId: A_EPISODE,
    });
  });
});
