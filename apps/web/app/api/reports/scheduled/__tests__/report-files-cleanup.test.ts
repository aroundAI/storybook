import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-74: a deleted account's report files stayed in storage for ever. The
 * hourly scheduled-reports cron now removes them, whichever way the account
 * was deleted, and a failure to clean up never costs the reports themselves.
 */

const cleanup = vi.hoisted(() => ({
  deleteOrphanedReportFiles: vi.fn(),
}));

vi.mock('@kit/content-analytics/server/report-storage', () => ({
  storeReport: vi.fn(),
  scheduledReportPath: vi.fn(),
  deleteOrphanedReportFiles: cleanup.deleteOrphanedReportFiles,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@kit/mailers', () => ({ getMailer: vi.fn() }));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler:
    (handler: (args: { request: Request }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request }),
}));

// No report is due: the run is only the cleanup
const admin = {
  from: () => ({
    select: () => ({
      eq: () => ({ lte: async () => ({ data: [], error: null }) }),
    }),
  }),
};

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => admin,
}));

function cronRequest() {
  return new Request('http://localhost/api/reports/scheduled', {
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

// The route pulls in the PDF renderer: a cold first import can take
// seconds, which is not what these tests measure
beforeAll(async () => {
  await import('../route');
}, 30_000);

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  cleanup.deleteOrphanedReportFiles.mockReset();
});

describe('the scheduled-reports cron removes deleted accounts’ report files', () => {
  it('runs the cleanup with the admin client', async () => {
    cleanup.deleteOrphanedReportFiles.mockResolvedValue({
      removed: 2,
      failed: 0,
    });
    const { GET } = await import('../route');

    const response = await GET(cronRequest() as never, {} as never);

    expect(cleanup.deleteOrphanedReportFiles).toHaveBeenCalledExactlyOnceWith(
      admin,
    );
    expect(await response.json()).toMatchObject({
      success: true,
      reportFiles: { removed: 2, failed: 0 },
    });
  });

  it('a failed cleanup does not fail the run', async () => {
    cleanup.deleteOrphanedReportFiles.mockRejectedValue(
      new Error('accounts unreadable'),
    );
    const { GET } = await import('../route');

    const response = await GET(cronRequest() as never, {} as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      reportFiles: null,
    });
  });
});
