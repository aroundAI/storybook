import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-213. Retry on Settings → Platforms clears the block Meta's code 368
 * put on one connection, through the user's own client, and leaves every
 * other connection as it was.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (fn: (data: unknown, user: unknown) => Promise<unknown>) =>
    (data: unknown) =>
      fn(data, { id: 'user-1' }),
}));

const BLOCKED = '11111111-2222-4333-8444-555555555551';
const OTHER = '11111111-2222-4333-8444-555555555552';
const UNSEEN = '11111111-2222-4333-8444-555555555553';

const block = {
  platform: 'facebook',
  code: 368,
  subcode: 4854002,
  message: 'Confirm your identity before you can publish as this Page.',
  at: '2026-10-20T00:31:00Z',
};

/** The rows the user's client can see (RLS) */
const visible = new Map<string, { id: string; metadata: unknown }>();

function from() {
  const eqs: Array<[string, unknown]> = [];
  let values: Record<string, unknown> | null = null;

  const run = () => {
    const hit = [...visible.values()].filter((row) =>
      eqs.every(
        ([column, value]) => (row as Record<string, unknown>)[column] === value,
      ),
    );
    if (values) for (const row of hit) Object.assign(row, values);
    return { data: hit.map((row) => ({ ...row })), error: null };
  };

  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      eqs.push([column, value]);
      return q;
    },
    update: (next: Record<string, unknown>) => {
      values = next;
      return q;
    },
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve(run()),
  };
  return q;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from }),
}));
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({ from }),
}));

beforeEach(() => {
  visible.clear();
  visible.set(BLOCKED, {
    id: BLOCKED,
    metadata: { publishBlock: block, profile_image_url: 'kept' },
  });
  visible.set(OTHER, { id: OTHER, metadata: { publishBlock: block } });
});

describe('Retry on a connection Meta paused (KB-213)', () => {
  it('clears that connection’s block and nothing else', async () => {
    const { retryPublishingAction } = await import(
      '../src/server/connection-actions'
    );

    const result = await retryPublishingAction({ connectionId: BLOCKED });

    expect(result).toEqual({ ok: true, data: { success: true } });
    expect(visible.get(BLOCKED)!.metadata).toEqual({
      profile_image_url: 'kept',
    });
    expect(visible.get(OTHER)!.metadata).toEqual({ publishBlock: block });
  });

  it('refuses a connection the user cannot see', async () => {
    const { retryPublishingAction } = await import(
      '../src/server/connection-actions'
    );

    const result = await retryPublishingAction({ connectionId: UNSEEN });

    expect(result).toEqual({
      ok: false,
      error:
        'That connection no longer exists, or you do not have access to it.',
    });
  });
});
