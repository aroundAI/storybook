import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-48. Who may link, and which facts, is the database's rule
 * (`apps/web/supabase/tests/database/studio-owner-access.test.sql`). These
 * check what the TypeScript owns:
 *
 *   R8  a re-link is sent as `on conflict do nothing`. `.upsert()` without
 *       `ignoreDuplicates` sends `do update`, which episode_facts has no policy
 *       for, so any batch holding one linked fact was refused whole.
 *   KB-6  a refusal comes back as a sentence, and an unlink that removed
 *       nothing is refused rather than reported as done.
 */

vi.mock('server-only', () => ({}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (fn: (data: Record<string, unknown>) => Promise<unknown>) =>
    fn,
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'user-1' }, error: null }),
}));

interface Result {
  data: unknown;
  error: { code?: string; message: string } | null;
}

const client = vi.hoisted(() => {
  const results: Result[] = [];
  const chain = {
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    then: (resolve: (value: Result) => unknown) =>
      Promise.resolve(results.shift() as Result).then(resolve),
  };

  return { from: vi.fn(() => chain), chain, results };
});

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => client,
}));

const { linkFactsToEpisodeAction, unlinkFactFromEpisodeAction } = await import(
  '../../server/episode-fact-actions'
);
const { EPISODE_FACT_REFUSALS } = await import(
  '../../server/episode-fact-refusals'
);

const EPISODE = '11111111-1111-4111-8111-111111111111';
const FACT_A = '22222222-2222-4222-8222-222222222222';
const FACT_B = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  client.results.length = 0;
});

describe('linkFactsToEpisodeAction', () => {
  it('sends a re-link as do-nothing, not as an update (R8)', async () => {
    client.results.push({ data: [{ id: 'l1' }], error: null });

    const result = await linkFactsToEpisodeAction({
      episodeId: EPISODE,
      factIds: [FACT_A, FACT_B],
    });

    expect(client.chain.upsert).toHaveBeenCalledWith(
      [
        { episode_id: EPISODE, fact_id: FACT_A, linked_by: 'user-1' },
        { episode_id: EPISODE, fact_id: FACT_B, linked_by: 'user-1' },
      ],
      { onConflict: 'episode_id,fact_id', ignoreDuplicates: true },
    );
    expect(result).toEqual({ ok: true, data: { linkedCount: 1 } });
  });

  it('returns the refusal as a sentence when the database refuses the link', async () => {
    client.results.push({
      data: null,
      error: { code: '42501', message: 'new row violates row-level security' },
    });

    const result = await linkFactsToEpisodeAction({
      episodeId: EPISODE,
      factIds: [FACT_A],
    });

    expect(result).toEqual({ ok: false, error: EPISODE_FACT_REFUSALS.link });
  });

  it('still throws a failure that is not a refusal', async () => {
    client.results.push({
      data: null,
      error: { code: 'XX000', message: 'internal' },
    });

    await expect(
      linkFactsToEpisodeAction({ episodeId: EPISODE, factIds: [FACT_A] }),
    ).rejects.toThrow();
  });
});

describe('unlinkFactFromEpisodeAction', () => {
  it('reports success when a link was removed', async () => {
    client.results.push({ data: [{ id: 'l1' }], error: null });

    const result = await unlinkFactFromEpisodeAction({
      episodeId: EPISODE,
      factId: FACT_A,
    });

    expect(result).toEqual({ ok: true, data: { success: true } });
  });

  it('refuses an unlink that removed nothing instead of reporting success', async () => {
    client.results.push({ data: [], error: null });

    const result = await unlinkFactFromEpisodeAction({
      episodeId: EPISODE,
      factId: FACT_A,
    });

    expect(result).toEqual({ ok: false, error: EPISODE_FACT_REFUSALS.unlink });
  });
});
