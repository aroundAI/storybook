import { describe, expect, it, vi } from 'vitest';

import { McpToolError } from '../../src/errors';
import type { McpToolDefinition } from '../../src/registry';
import {
  cancelScheduledPublishTool,
  markPublishRemovedTool,
} from '../../src/server/tools/publish';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

vi.mock('server-only', () => ({}));

/**
 * KB-207. A deleted episode's scheduled publish could not be cancelled over
 * MCP: the tool's scope check read the episode, and deleted episodes are
 * hidden. It now checks the publish is the team's, whatever its episode.
 * `mark_publish_removed` marks a video taken down on its platform.
 */

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const PUBLISH = '77777777-7777-4777-8777-777777777777';

const filter = (call: RecordedCall, method: string, column: string) =>
  call.filters.find((f) => f.method === method && f.args[0] === column);

/** A publish of a deleted episode, owned by `owner`'s team */
function team(options: { owner?: string; status?: string; role?: string }) {
  const owner = options.owner ?? ACCOUNT;

  return createFakeClient({
    publishes: (call) => {
      if (call.op === 'delete') return { data: [{ id: PUBLISH }] };
      if (call.op === 'update') return { data: [{ id: PUBLISH }] };

      // The team check names the account; the services' reads do not
      const team = filter(call, 'eq', 'episode.project.account_id');
      if (team && team.args[1] !== owner) return { data: null };

      return {
        data: {
          id: PUBLISH,
          episode_id: EPISODE,
          status: options.status ?? 'scheduled',
          metadata: { title: 'kept' },
          episodes: { project_id: PROJECT },
          episode: { project: { account_id: owner } },
        },
      };
    },
    // The episode is deleted: a read that hides deleted episodes finds none
    episodes: (call) =>
      filter(call, 'is', 'deleted_at') ? { data: null } : { data: [] },
    project_members: { role: options.role ?? 'owner' },
  });
}

const run = (
  tool: unknown,
  fake: ReturnType<typeof createFakeClient>,
): Promise<{ structuredContent: Record<string, unknown> }> =>
  (tool as McpToolDefinition).handler(
    { publishId: PUBLISH } as never,
    fakeContext(fake.client) as never,
  ) as never;

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof McpToolError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('cancel_scheduled_publish (KB-207)', () => {
  it("cancels a deleted episode's scheduled publish", async () => {
    const fake = team({});

    const result = await run(cancelScheduledPublishTool, fake);

    expect(result.structuredContent).toMatchObject({
      publishId: PUBLISH,
      cancelled: true,
    });
    expect(
      fake.calls.some((c) => c.table === 'publishes' && c.op === 'delete'),
    ).toBe(true);
  });

  it("still refuses another team's publish", async () => {
    const fake = team({ owner: OTHER });

    const error = await rejection(run(cancelScheduledPublishTool, fake));

    expect(error.code).toBe('NOT_FOUND');
    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false);
  });
});

describe('mark_publish_removed (KB-207)', () => {
  it('marks a published video removed, saying when and why', async () => {
    const fake = team({ status: 'published' });

    const result = await run(markPublishRemovedTool, fake);

    expect(result.structuredContent).toMatchObject({ removed: true });
    const update = fake.calls.find(
      (c) => c.table === 'publishes' && c.op === 'update',
    )!;
    expect(update.payload).toMatchObject({
      status: 'deleted',
      metadata: {
        title: 'kept',
        removedAt: expect.any(String),
        removedReason: 'marked as removed in StoryBook',
      },
    });
    expect(update.filters).toContainEqual({
      method: 'eq',
      args: ['status', 'published'],
    });
  });

  it('refuses a project member, as the Schedule page does', async () => {
    const fake = team({ status: 'published', role: 'member' });

    const error = await rejection(run(markPublishRemovedTool, fake));

    expect(error.message).toBe(
      'Only project owners and admins can mark a video as removed.',
    );
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('refuses a publish that has not gone out', async () => {
    const fake = team({ status: 'scheduled' });

    const error = await rejection(run(markPublishRemovedTool, fake));

    expect(error.message).toMatch(/scheduled, not published/);
  });

  it("refuses another team's publish", async () => {
    const error = await rejection(
      run(markPublishRemovedTool, team({ owner: OTHER, status: 'published' })),
    );

    expect(error.code).toBe('NOT_FOUND');
  });
});
