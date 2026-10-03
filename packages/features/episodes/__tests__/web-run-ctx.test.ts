import { describe, expect, it, vi } from 'vitest';

/**
 * FILM-1912: a web action opens its run with the past-performance reader
 * on the caller's own client, which `openRun` uses for ideation, story
 * and shots when the team turned the setting on.
 */

const created = vi.hoisted(() => ({ clients: [] as unknown[] }));

vi.mock('@kit/content-analytics/server/performance-reader', () => ({
  createPerformanceReader: (client: unknown) => {
    created.clients.push(client);
    return { videos: vi.fn(), genome: vi.fn(), concludedExperiments: vi.fn() };
  },
}));

describe('webRunCtx (FILM-1912)', () => {
  it('carries the caller’s client, identity and a reader on that same client', async () => {
    const { webRunCtx } = await import('../src/lib/server/web-run-ctx');
    const client = { tag: 'caller' } as never;

    const ctx = await webRunCtx(client, 'account', 'user');

    expect(ctx).toMatchObject({ client, accountId: 'account', userId: 'user' });
    expect(ctx.performance).toBeDefined();
    expect(created.clients).toEqual([client]);
  });
});
