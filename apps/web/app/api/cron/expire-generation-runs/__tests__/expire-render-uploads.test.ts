import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-2003: the hourly cron also fails StorybookStudio renders left
 * uploading for 24 hours, through `expire_stale_render_uploads()`, after
 * the run expiry, FILM-2002's stale-session close and the tool-call trim.
 */

const rpc = vi.hoisted(() => vi.fn());
const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const closeStaleEditSessions = vi.hoisted(() => vi.fn());

vi.mock('@kit/desktop-integration/server', () => ({
  closeStaleEditSessions,
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({ rpc }),
}));

vi.mock('@kit/shared/logger', () => ({ getLogger: async () => logged }));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler:
    (handler: (args: { request: Request }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request }),
}));

async function call() {
  const { GET } = await import('../route');

  return GET(
    new Request('http://localhost/api/cron/expire-generation-runs', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }) as never,
    {} as never,
  );
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  rpc.mockReset();
  closeStaleEditSessions.mockReset();
  closeStaleEditSessions.mockResolvedValue({ closed: 0, failed: 0, ids: [] });
  logged.info.mockReset();
  logged.error.mockReset();
});

describe('stale render uploads in the hourly cron', () => {
  it('fails renders left uploading for a day, after the expiry and the trim', async () => {
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'expire_stale_render_uploads' ? 2 : 0,
      error: null,
    }));

    const response = await call();

    expect(response.status).toBe(200);
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'expire_generation_runs',
      'trim_mcp_tool_calls',
      'expire_stale_render_uploads',
    ]);
    expect(logged.info).toHaveBeenCalledWith(
      expect.objectContaining({ failedRenders: 2 }),
      'Failed render uploads left unfinalized for 24 hours',
    );
  });

  it('answers 500 when the render expiry fails', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'expire_stale_render_uploads'
        ? { data: null, error: { message: 'boom' } }
        : { data: 0, error: null },
    );

    const response = await call();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Render upload expiry failed',
      expired: 0,
      trimmed: 0,
      staleEditSessions: { closed: 0, failed: 0 },
    });
  });
});
