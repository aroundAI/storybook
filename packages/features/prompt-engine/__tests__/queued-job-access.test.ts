import { describe, expect, it } from 'vitest';

import {
  type LlmJobAuthzClient,
  QueuedJobRefused,
  assertQueuedJobAccess,
} from '../src/lib/server/llm-job-target';

/**
 * KB-49. The workers run on the service-role key. The producer authorised
 * each job as its caller (KB-31, KB-46); the worker asks again, for the user
 * the job names, when it runs.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const WRITER = '44444444-4444-4444-8444-444444444444';
const REVOKED = '55555555-5555-4555-8555-555555555555';
const OTHER_PROJECT = '66666666-6666-4666-8666-666666666666';
const OTHER_ACCOUNT = '77777777-7777-4777-8777-777777777777';

interface World {
  episodes: Record<string, { project_id: string; deleted_at: string | null }>;
  projects: Record<string, { account_id: string }>;
  /** `${user}:${project}` pairs `can_user_write_project` answers true for */
  writers: Set<string>;
  rpcError?: string;
}

function world(): World {
  return {
    episodes: { [EPISODE]: { project_id: PROJECT, deleted_at: null } },
    projects: {
      [PROJECT]: { account_id: ACCOUNT },
      [OTHER_PROJECT]: { account_id: OTHER_ACCOUNT },
    },
    writers: new Set([`${WRITER}:${PROJECT}`]),
  };
}

function client(w: World): LlmJobAuthzClient & { rpcCalls: unknown[] } {
  const rpcCalls: unknown[] = [];

  return {
    rpcCalls,
    from(relation: string) {
      const rows: Record<string, unknown> =
        relation === 'episodes' ? w.episodes : w.projects;
      let id = '';

      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => {
          id = value;
          return builder;
        },
        maybeSingle: async () => ({ data: rows[id] ?? null, error: null }),
      };

      return builder;
    },
    rpc(fn: string, args: object) {
      rpcCalls.push({ fn, args });
      const { target_user_id, target_project_id } = args as {
        target_user_id: string;
        target_project_id: string;
      };

      return Promise.resolve(
        w.rpcError
          ? { data: null, error: { message: w.rpcError } }
          : {
              data: w.writers.has(`${target_user_id}:${target_project_id}`),
              error: null,
            },
      );
    },
  };
}

describe('assertQueuedJobAccess', () => {
  it('lets a writer of the project run an episode job', async () => {
    const c = client(world());

    await expect(
      assertQueuedJobAccess(c, {
        userId: WRITER,
        accountId: ACCOUNT,
        projectId: PROJECT,
        episodeId: EPISODE,
      }),
    ).resolves.toBeUndefined();

    expect(c.rpcCalls).toEqual([
      {
        fn: 'can_user_write_project',
        args: { target_user_id: WRITER, target_project_id: PROJECT },
      },
    ]);
  });

  it('refuses a user whose write access was revoked after queueing', async () => {
    await expect(
      assertQueuedJobAccess(client(world()), {
        userId: REVOKED,
        accountId: ACCOUNT,
        projectId: PROJECT,
      }),
    ).rejects.toThrow(QueuedJobRefused);
  });

  it("refuses an episode that is not in the job's project", async () => {
    const w = world();
    w.writers.add(`${WRITER}:${OTHER_PROJECT}`);

    await expect(
      assertQueuedJobAccess(client(w), {
        userId: WRITER,
        accountId: OTHER_ACCOUNT,
        projectId: OTHER_PROJECT,
        episodeId: EPISODE,
      }),
    ).rejects.toThrow(/not in the job's project/);
  });

  it('checks the episode’s own project when the payload names none', async () => {
    const c = client(world());

    await assertQueuedJobAccess(c, {
      userId: WRITER,
      accountId: ACCOUNT,
      episodeId: EPISODE,
    });

    expect(c.rpcCalls).toHaveLength(1);
  });

  it('refuses a deleted episode', async () => {
    const w = world();
    w.episodes[EPISODE]!.deleted_at = '2026-09-25T00:00:00Z';

    await expect(
      assertQueuedJobAccess(client(w), {
        userId: WRITER,
        accountId: ACCOUNT,
        projectId: PROJECT,
        episodeId: EPISODE,
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it('refuses a job billed to an account that does not own its project', async () => {
    await expect(
      assertQueuedJobAccess(client(world()), {
        userId: WRITER,
        accountId: OTHER_ACCOUNT,
        projectId: PROJECT,
      }),
    ).rejects.toThrow(/does not own its project/);
  });

  it("lets a job on the caller's own text run on their personal account", async () => {
    await expect(
      assertQueuedJobAccess(client(world()), {
        userId: WRITER,
        accountId: WRITER,
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses a job that names no project and bills someone else', async () => {
    await expect(
      assertQueuedJobAccess(client(world()), {
        userId: WRITER,
        accountId: ACCOUNT,
      }),
    ).rejects.toThrow(QueuedJobRefused);
  });

  it('throws, not refuses, when the check itself fails', async () => {
    const w = world();
    w.rpcError = 'connection reset';

    const attempt = assertQueuedJobAccess(client(w), {
      userId: WRITER,
      accountId: ACCOUNT,
      projectId: PROJECT,
    });

    await expect(attempt).rejects.toThrow(/connection reset/);
    await expect(attempt).rejects.not.toBeInstanceOf(QueuedJobRefused);
  });
});
